# backend/settlement.py

class Expense:
    def __init__(self, payer, amount, involved):
        self.payer = payer
        self.amount = float(amount)
        self.involved = involved

def calculate_settlements(expenses):
    balances = {}

    # 1. Calculate Net Balances
    for expense in expenses:
        if expense.payer not in balances: balances[expense.payer] = 0.0
        balances[expense.payer] += expense.amount

        split_amount = expense.amount / len(expense.involved)
        for person in expense.involved:
            if person not in balances: balances[person] = 0.0
            balances[person] -= split_amount

    # 2. Separate Debtors and Creditors
    debtors = []
    creditors = []

    for person, amount in balances.items():
        net = round(amount, 2)
        if net < -0.01: debtors.append({'person': person, 'amount': net})
        if net > 0.01: creditors.append({'person': person, 'amount': net})

    debtors.sort(key=lambda x: x['amount'])
    creditors.sort(key=lambda x: x['amount'], reverse=True)

    # 3. Match them up
    settlements = []
    i = 0
    j = 0

    while i < len(debtors) and j < len(creditors):
        debtor = debtors[i]
        creditor = creditors[j]

        amount = min(abs(debtor['amount']), creditor['amount'])
        settlements.append(f"{debtor['person']} owes {creditor['person']} ${amount:.2f}")

        debtor['amount'] += amount
        creditor['amount'] -= amount

        if abs(debtor['amount']) < 0.01: i += 1
        if creditor['amount'] < 0.01: j += 1

    return settlements