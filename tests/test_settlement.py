from api.settlement import Expense, calculate_settlement_details, calculate_settlements


def test_simple_two_people():
    expenses = [Expense('Alice', 20, ['Alice', 'Bob'])]
    result = calculate_settlements(expenses)
    assert isinstance(result, list)
    assert any('Bob owes Alice' in line for line in result)


def test_no_debts():
    expenses = [Expense('Alice', 10, ['Alice'])]
    result = calculate_settlements(expenses)
    assert result == ["No debts found!"]


def test_structured_settlement_is_minimized_and_uses_cents():
    expenses = [
        Expense('Alice', 30, ['Alice', 'Bob', 'Cara']),
        Expense('Bob', 15, ['Alice', 'Bob']),
    ]

    result = calculate_settlement_details(expenses)

    assert result == [
        {
            'id': 'settlement:Bob:Alice:250',
            'debtor': 'Bob',
            'creditor': 'Alice',
            'amount': 2.5,
            'legacyLine': 'Bob owes Alice $2.50',
        },
        {
            'id': 'settlement:Cara:Alice:1000',
            'debtor': 'Cara',
            'creditor': 'Alice',
            'amount': 10.0,
            'legacyLine': 'Cara owes Alice $10.00',
        },
    ]
