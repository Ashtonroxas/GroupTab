from api.settlement import Expense, calculate_settlements


def test_simple_two_people():
    expenses = [Expense('Alice', 20, ['Alice', 'Bob'])]
    result = calculate_settlements(expenses)
    assert isinstance(result, list)
    assert any('Bob owes Alice' in line for line in result)


def test_no_debts():
    expenses = [Expense('Alice', 10, ['Alice'])]
    result = calculate_settlements(expenses)
    assert result == ["No debts found!"]
