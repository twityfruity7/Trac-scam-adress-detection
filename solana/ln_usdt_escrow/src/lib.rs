use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    hash::hash,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    system_instruction,
    sysvar::{clock::Clock, rent::Rent, Sysvar},
};

solana_program::declare_id!("evYHPt33hCYHNm7iFHAHXmSkYrEoDnBSv69MHwLfYyK");

const ESCROW_SEED: &[u8] = b"escrow";

#[repr(u32)]
enum EscrowError {
    InvalidInstruction = 1,
    InvalidEscrowPda = 2,
    InvalidVaultAta = 3,
    InvalidTokenAccount = 4,
    InvalidSigner = 5,
    InvalidPreimage = 6,
    NotActive = 7,
    TooEarly = 8,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
struct EscrowState {
    v: u8,
    status: u8, // 0=active, 1=claimed, 2=refunded
    payment_hash: [u8; 32],
    recipient: [u8; 32],
    refund: [u8; 32],
    refund_after: i64,
    mint: [u8; 32],
    amount: u64,
    vault: [u8; 32],
    bump: u8,
}

impl EscrowState {
    const V1: u8 = 1;
    const STATUS_ACTIVE: u8 = 0;
    const STATUS_CLAIMED: u8 = 1;
    const STATUS_REFUNDED: u8 = 2;
}

enum EscrowIx {
    Init {
        payment_hash: [u8; 32],
        recipient: Pubkey,
        refund: Pubkey,
        refund_after: i64,
        amount: u64,
    },
    Claim { preimage: [u8; 32] },
    Refund,
}

fn read_bytes<const N: usize>(data: &mut &[u8]) -> Result<[u8; N], ProgramError> {
    if data.len() < N {
        return Err(EscrowError::InvalidInstruction.into());
    }
    let (head, tail) = data.split_at(N);
    *data = tail;
    let mut out = [0u8; N];
    out.copy_from_slice(head);
    Ok(out)
}

fn read_u64_le(data: &mut &[u8]) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(read_bytes::<8>(data)?))
}

fn read_i64_le(data: &mut &[u8]) -> Result<i64, ProgramError> {
    Ok(i64::from_le_bytes(read_bytes::<8>(data)?))
}

fn parse_ix(input: &[u8]) -> Result<EscrowIx, ProgramError> {
    let mut data = input;
    if data.is_empty() {
        return Err(EscrowError::InvalidInstruction.into());
    }
    let tag = data[0];
    data = &data[1..];
    match tag {
        0 => {
            let payment_hash = read_bytes::<32>(&mut data)?;
            let recipient = Pubkey::new_from_array(read_bytes::<32>(&mut data)?);
            let refund = Pubkey::new_from_array(read_bytes::<32>(&mut data)?);
            let refund_after = read_i64_le(&mut data)?;
            let amount = read_u64_le(&mut data)?;
            Ok(EscrowIx::Init {
                payment_hash,
                recipient,
                refund,
                refund_after,
                amount,
            })
        }
        1 => {
            let preimage = read_bytes::<32>(&mut data)?;
            Ok(EscrowIx::Claim { preimage })
        }
        2 => Ok(EscrowIx::Refund),
        _ => Err(EscrowError::InvalidInstruction.into()),
    }
}

fn assert_signer(ai: &AccountInfo) -> Result<(), ProgramError> {
    if !ai.is_signer {
        return Err(EscrowError::InvalidSigner.into());
    }
    Ok(())
}

fn assert_writable(ai: &AccountInfo) -> Result<(), ProgramError> {
    if !ai.is_writable {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

fn pda_for_hash(program_id: &Pubkey, payment_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ESCROW_SEED, payment_hash], program_id)
}

fn require_active(state: &EscrowState) -> Result<(), ProgramError> {
    if state.status != EscrowState::STATUS_ACTIVE {
        return Err(EscrowError::NotActive.into());
    }
    Ok(())
}

entrypoint!(process_instruction);

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let ix = parse_ix(instruction_data)?;
    match ix {
        EscrowIx::Init {
            payment_hash,
            recipient,
            refund,
            refund_after,
            amount,
        } => process_init(
            program_id,
            accounts,
            payment_hash,
            recipient,
            refund,
            refund_after,
            amount,
        ),
        EscrowIx::Claim { preimage } => process_claim(program_id, accounts, preimage),
        EscrowIx::Refund => process_refund(program_id, accounts),
    }
}

fn process_init(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payment_hash: [u8; 32],
    recipient: Pubkey,
    refund: Pubkey,
    refund_after: i64,
    amount: u64,
) -> ProgramResult {
    // Accounts:
    // 0 [signer,writable] payer/refund authority (initial depositor)
    // 1 [writable] payer token account (USDT)
    // 2 [writable] escrow PDA (state account)
    // 3 [writable] vault ATA for escrow PDA + mint
    // 4 [] mint
    // 5 [] system program
    // 6 [] token program
    // 7 [] associated token program
    // 8 [] rent sysvar
    let acc_iter = &mut accounts.iter();
    let payer = next_account_info(acc_iter)?;
    let payer_token = next_account_info(acc_iter)?;
    let escrow = next_account_info(acc_iter)?;
    let vault = next_account_info(acc_iter)?;
    let mint = next_account_info(acc_iter)?;
    let system_program = next_account_info(acc_iter)?;
    let token_program = next_account_info(acc_iter)?;
    let ata_program = next_account_info(acc_iter)?;
    let rent_sysvar = next_account_info(acc_iter)?;

    assert_signer(payer)?;
    assert_writable(payer)?;
    assert_writable(payer_token)?;
    assert_writable(escrow)?;
    assert_writable(vault)?;

    let (expected_escrow, bump) = pda_for_hash(program_id, &payment_hash);
    if expected_escrow != *escrow.key {
        msg!("escrow PDA mismatch");
        return Err(EscrowError::InvalidEscrowPda.into());
    }

    let expected_vault = spl_associated_token_account::get_associated_token_address(escrow.key, mint.key);
    if expected_vault != *vault.key {
        msg!("vault ATA mismatch");
        return Err(EscrowError::InvalidVaultAta.into());
    }

    // Validate payer token account.
    let payer_token_state = spl_token::state::Account::unpack(&payer_token.try_borrow_data()?)
        .map_err(|_| EscrowError::InvalidTokenAccount)?;
    if payer_token_state.owner != *payer.key {
        msg!("payer token owner mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }
    if payer_token_state.mint != *mint.key {
        msg!("payer token mint mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }
    if payer_token_state.amount < amount {
        msg!("payer token insufficient balance");
        return Err(EscrowError::InvalidTokenAccount.into());
    }

    // Create escrow PDA account if uninitialized.
    if escrow.data_is_empty() {
        let rent = Rent::from_account_info(rent_sysvar)?;
        let space = 1usize + 1usize + 32 + 32 + 32 + 8 + 32 + 8 + 32 + 1; // EscrowState layout
        let lamports = rent.minimum_balance(space);
        invoke_signed(
            &system_instruction::create_account(payer.key, escrow.key, lamports, space as u64, program_id),
            &[payer.clone(), escrow.clone(), system_program.clone()],
            &[&[ESCROW_SEED, &payment_hash, &[bump]]],
        )?;
    }

    // Create vault ATA if needed.
    if vault.data_is_empty() {
        let ix = spl_associated_token_account::instruction::create_associated_token_account(
            payer.key,
            escrow.key,
            mint.key,
            token_program.key,
        );
        invoke(
            &ix,
            &[
                payer.clone(),
                vault.clone(),
                escrow.clone(),
                mint.clone(),
                system_program.clone(),
                token_program.clone(),
                ata_program.clone(),
                rent_sysvar.clone(),
            ],
        )?;
    }

    // Transfer tokens into the vault.
    let transfer_ix = spl_token::instruction::transfer(
        token_program.key,
        payer_token.key,
        vault.key,
        payer.key,
        &[],
        amount,
    )?;
    invoke(&transfer_ix, &[payer_token.clone(), vault.clone(), payer.clone(), token_program.clone()])?;

    // Persist state.
    let state = EscrowState {
        v: EscrowState::V1,
        status: EscrowState::STATUS_ACTIVE,
        payment_hash,
        recipient: recipient.to_bytes(),
        refund: refund.to_bytes(),
        refund_after,
        mint: mint.key.to_bytes(),
        amount,
        vault: vault.key.to_bytes(),
        bump,
    };
    state
        .serialize(&mut &mut escrow.try_borrow_mut_data()?[..])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

fn process_claim(program_id: &Pubkey, accounts: &[AccountInfo], preimage: [u8; 32]) -> ProgramResult {
    // Accounts:
    // 0 [signer] recipient
    // 1 [writable] escrow PDA (state account)
    // 2 [writable] vault ATA
    // 3 [writable] recipient token account
    // 4 [] token program
    let acc_iter = &mut accounts.iter();
    let recipient = next_account_info(acc_iter)?;
    let escrow = next_account_info(acc_iter)?;
    let vault = next_account_info(acc_iter)?;
    let recipient_token = next_account_info(acc_iter)?;
    let token_program = next_account_info(acc_iter)?;

    assert_signer(recipient)?;
    assert_writable(escrow)?;
    assert_writable(vault)?;
    assert_writable(recipient_token)?;

    let mut state = EscrowState::try_from_slice(&escrow.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    require_active(&state)?;

    let recipient_pk = Pubkey::new_from_array(state.recipient);
    if recipient_pk != *recipient.key {
        msg!("recipient mismatch");
        return Err(EscrowError::InvalidSigner.into());
    }
    if Pubkey::new_from_array(state.vault) != *vault.key {
        msg!("vault mismatch");
        return Err(EscrowError::InvalidVaultAta.into());
    }

    let payment_hash = hash(&preimage).to_bytes();
    if payment_hash != state.payment_hash {
        msg!("invalid preimage");
        return Err(EscrowError::InvalidPreimage.into());
    }

    // Validate vault + recipient token accounts.
    let vault_state = spl_token::state::Account::unpack(&vault.try_borrow_data()?)
        .map_err(|_| EscrowError::InvalidTokenAccount)?;
    let recipient_token_state = spl_token::state::Account::unpack(&recipient_token.try_borrow_data()?)
        .map_err(|_| EscrowError::InvalidTokenAccount)?;

    let mint_pk = Pubkey::new_from_array(state.mint);
    if vault_state.mint != mint_pk || recipient_token_state.mint != mint_pk {
        msg!("mint mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }
    if recipient_token_state.owner != *recipient.key {
        msg!("recipient token owner mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }

    let (expected_escrow, bump) = pda_for_hash(program_id, &state.payment_hash);
    if expected_escrow != *escrow.key || bump != state.bump {
        msg!("escrow PDA mismatch");
        return Err(EscrowError::InvalidEscrowPda.into());
    }
    if vault_state.owner != expected_escrow {
        msg!("vault authority mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }

    let amount = state.amount;
    let transfer_ix = spl_token::instruction::transfer(
        token_program.key,
        vault.key,
        recipient_token.key,
        escrow.key,
        &[],
        amount,
    )?;
    invoke_signed(
        &transfer_ix,
        &[vault.clone(), recipient_token.clone(), escrow.clone(), token_program.clone()],
        &[&[ESCROW_SEED, &state.payment_hash, &[state.bump]]],
    )?;

    state.status = EscrowState::STATUS_CLAIMED;
    state.amount = 0;
    state
        .serialize(&mut &mut escrow.try_borrow_mut_data()?[..])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

fn process_refund(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    // Accounts:
    // 0 [signer] refund authority
    // 1 [writable] escrow PDA (state account)
    // 2 [writable] vault ATA
    // 3 [writable] refund token account
    // 4 [] token program
    // 5 [] clock sysvar
    let acc_iter = &mut accounts.iter();
    let refund = next_account_info(acc_iter)?;
    let escrow = next_account_info(acc_iter)?;
    let vault = next_account_info(acc_iter)?;
    let refund_token = next_account_info(acc_iter)?;
    let token_program = next_account_info(acc_iter)?;
    let clock_sysvar = next_account_info(acc_iter)?;

    assert_signer(refund)?;
    assert_writable(escrow)?;
    assert_writable(vault)?;
    assert_writable(refund_token)?;

    let mut state = EscrowState::try_from_slice(&escrow.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    require_active(&state)?;

    let refund_pk = Pubkey::new_from_array(state.refund);
    if refund_pk != *refund.key {
        msg!("refund signer mismatch");
        return Err(EscrowError::InvalidSigner.into());
    }
    if Pubkey::new_from_array(state.vault) != *vault.key {
        msg!("vault mismatch");
        return Err(EscrowError::InvalidVaultAta.into());
    }

    let clock = Clock::from_account_info(clock_sysvar)?;
    if clock.unix_timestamp < state.refund_after {
        msg!("too early to refund");
        return Err(EscrowError::TooEarly.into());
    }

    let vault_state = spl_token::state::Account::unpack(&vault.try_borrow_data()?)
        .map_err(|_| EscrowError::InvalidTokenAccount)?;
    let refund_token_state = spl_token::state::Account::unpack(&refund_token.try_borrow_data()?)
        .map_err(|_| EscrowError::InvalidTokenAccount)?;

    let mint_pk = Pubkey::new_from_array(state.mint);
    if vault_state.mint != mint_pk || refund_token_state.mint != mint_pk {
        msg!("mint mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }
    if refund_token_state.owner != *refund.key {
        msg!("refund token owner mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }

    let (expected_escrow, bump) = pda_for_hash(program_id, &state.payment_hash);
    if expected_escrow != *escrow.key || bump != state.bump {
        msg!("escrow PDA mismatch");
        return Err(EscrowError::InvalidEscrowPda.into());
    }
    if vault_state.owner != expected_escrow {
        msg!("vault authority mismatch");
        return Err(EscrowError::InvalidTokenAccount.into());
    }

    let amount = state.amount;
    let transfer_ix = spl_token::instruction::transfer(
        token_program.key,
        vault.key,
        refund_token.key,
        escrow.key,
        &[],
        amount,
    )?;
    invoke_signed(
        &transfer_ix,
        &[vault.clone(), refund_token.clone(), escrow.clone(), token_program.clone()],
        &[&[ESCROW_SEED, &state.payment_hash, &[state.bump]]],
    )?;

    state.status = EscrowState::STATUS_REFUNDED;
    state.amount = 0;
    state
        .serialize(&mut &mut escrow.try_borrow_mut_data()?[..])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(())
}

