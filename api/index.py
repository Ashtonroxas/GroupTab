from flask import Flask, request, jsonify
from flask_cors import CORS
# Ensure settlement.py is in the 'api' folder for this import to work!
from settlement import calculate_settlements, Expense

app = Flask(__name__)
CORS(app)  # Allows the React frontend to communicate with this backend

# --- 1. HEALTH CHECK ROUTE (New) ---
@app.route('/api', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "message": "Backend is running!"})

# --- 2. CALCULATION ROUTE ---
# Matches the path in your vercel.json rewrite
@app.route('/api/calculate', methods=['POST'])
def calculate():
    try:
        data = request.json
        
        # Convert JSON data into our Python objects
        expenses_list = []
        for item in data:
            # Ensure 'settlement.py' has an Expense class accepting these 3 args
            expenses_list.append(Expense(item['payer'], item['amount'], item['involved']))

        results = calculate_settlements(expenses_list)
        return jsonify(results)
    except Exception as e:
        # Returns specific error message to the frontend if something crashes
        return jsonify({"error": str(e)}), 500

# Vercel ignores this block, but it's useful for local testing
if __name__ == '__main__':
    app.run(debug=True, port=5000)