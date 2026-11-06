from collections import defaultdict


class Expense:
    def __init__(self, payer, amount, involved):
        self.payer = payer
        self.amount = float(amount)
        self.involved = involved


def _to_cents(amount):
    return int(round(float(amount) * 100))


def calculate_settlement_details(expenses):
    """Return structured, minimized repayment records without float drift."""
    balances = defaultdict(int)

    for expense in expenses:
        if not expense.amount or not expense.payer or not expense.involved:
            continue

        amount_cents = _to_cents(expense.amount)
        if amount_cents <= 0:
            continue

        base_share, remainder = divmod(amount_cents, len(expense.involved))
        balances[expense.payer] += amount_cents
        for index, person in enumerate(expense.involved):
            balances[person] -= base_share + (1 if index < remainder else 0)

    debtors = sorted([[name, -balance] for name, balance in balances.items() if balance < 0], key=lambda entry: entry[0].lower())
    creditors = sorted([[name, balance] for name, balance in balances.items() if balance > 0], key=lambda entry: entry[0].lower())

    settlements = []
    debtor_index = creditor_index = 0
    while debtor_index < len(debtors) and creditor_index < len(creditors):
        debtor, debt = debtors[debtor_index]
        creditor, credit = creditors[creditor_index]
        transfer = min(debt, credit)
        amount = transfer / 100
        legacy_line = f"{debtor} owes {creditor} ${amount:.2f}"
        settlements.append({
            'id': f"settlement:{debtor}:{creditor}:{transfer}",
            'debtor': debtor,
            'creditor': creditor,
            'amount': amount,
            'legacyLine': legacy_line,
        })

        debtors[debtor_index][1] -= transfer
        creditors[creditor_index][1] -= transfer
        if debtors[debtor_index][1] == 0:
            debtor_index += 1
        if creditors[creditor_index][1] == 0:
            creditor_index += 1

    return settlements


def calculate_settlements(expenses):
    """Backward-compatible human-readable settlement lines."""
    settlements = calculate_settlement_details(expenses)
    return [settlement['legacyLine'] for settlement in settlements] or ["No debts found!"]
