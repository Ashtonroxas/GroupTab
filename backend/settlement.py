# backend/settlement.py

class Expense:
    def __init__(self, payer, amount, involved):
        self.payer = payer
        self.amount = float(amount)
        self.involved = involved

def calculate_settlements(expenses):
    # Key format: "Debtor->Creditor"
    # Value: Amount owed
    pairwise_debts = {}

    for exp in expenses:
        payer = exp.payer
        amount = exp.amount
        involved = exp.involved

        # Basic validation (same as your JS check)
        if not amount or not payer or not involved or len(involved) == 0:
            continue

        split_amount = amount / len(involved)

        for person in involved:
            if person == payer:
                continue  # Skip if the person is the one who paid

            key = f"{person}->{payer}"
            reverse_key = f"{payer}->{person}"

            # Mutual Cancellation: Check if the payer already owes this person money
            if reverse_key in pairwise_debts:
                pairwise_debts[reverse_key] -= split_amount

                # If the balance flips (they now owe the payer), move it to the correct key
                # Using a small epsilon for float comparison safety
                if pairwise_debts[reverse_key] < -0.001:
                    remaining_debt = abs(pairwise_debts[reverse_key])
                    del pairwise_debts[reverse_key]
                    pairwise_debts[key] = remaining_debt
                
                # If they exactly paid off the debt, remove the key
                elif abs(pairwise_debts[reverse_key]) < 0.001:
                    del pairwise_debts[reverse_key]

            else:
                # Standard addition: add to the amount this person owes the payer
                if key in pairwise_debts:
                    pairwise_debts[key] += split_amount
                else:
                    pairwise_debts[key] = split_amount

    # Convert the pairwise object into the display strings
    results = []
    for key, amount in pairwise_debts.items():
        if amount > 0.01:  # Filter out fractions of a cent
            debtor, creditor = key.split('->')
            results.append(f"{debtor} owes {creditor} ${amount:.2f}")

    return results if len(results) > 0 else ["No debts found!"]