class Expense:
    def __init__(self, payer, amount, involved):
        self.payer = payer
        self.amount = float(amount)
        self.involved = involved


def _to_cents(amount):
    return int(round(float(amount) * 100))


def calculate_settlement_details(expenses):
    """Return direct payer-to-consumer repayments, with pairwise cancellation."""
    pairwise_debts = {}

    for expense in expenses:
        if not expense.amount or not expense.payer or not expense.involved:
            continue

        amount_cents = _to_cents(expense.amount)
        if amount_cents <= 0:
            continue

        base_share, remainder = divmod(amount_cents, len(expense.involved))
        for index, person in enumerate(expense.involved):
            # The payer covers their own portion, so they do not owe themselves.
            if person == expense.payer:
                continue

            share_cents = base_share + (1 if index < remainder else 0)
            if share_cents <= 0:
                continue

            debt_key = (person, expense.payer)
            reverse_key = (expense.payer, person)
            reverse_debt = pairwise_debts.get(reverse_key, 0)

            # Only cancel debts between the same two people. This preserves the
            # direct relationship to the receipt payer instead of rerouting a
            # payment through another participant in the group.
            if reverse_debt:
                cancelled = min(reverse_debt, share_cents)
                remaining_reverse = reverse_debt - cancelled
                remaining_debt = share_cents - cancelled
                if remaining_reverse:
                    pairwise_debts[reverse_key] = remaining_reverse
                else:
                    pairwise_debts.pop(reverse_key, None)
                if remaining_debt:
                    pairwise_debts[debt_key] = pairwise_debts.get(debt_key, 0) + remaining_debt
            else:
                pairwise_debts[debt_key] = pairwise_debts.get(debt_key, 0) + share_cents

    settlements = []
    for (debtor, creditor), amount_cents in sorted(
        pairwise_debts.items(), key=lambda entry: (entry[0][1].lower(), entry[0][0].lower())
    ):
        if amount_cents <= 0:
            continue
        amount = amount_cents / 100
        legacy_line = f"{debtor} owes {creditor} ${amount:.2f}"
        settlements.append({
            'id': f"settlement:{debtor}:{creditor}:{amount_cents}",
            'debtor': debtor,
            'creditor': creditor,
            'amount': amount,
            'legacyLine': legacy_line,
        })

    return settlements


def calculate_settlements(expenses):
    """Backward-compatible human-readable settlement lines."""
    settlements = calculate_settlement_details(expenses)
    return [settlement['legacyLine'] for settlement in settlements] or ["No debts found!"]
