from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os

# This tells Vercel to look inside the 'api' folder for settlement.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Now this import will work!
from settlement import calculate_settlements, Expense

app = Flask(__name__)
CORS(app)

@app.route('/api', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy", "message": "Backend is running!"})

@app.route('/api/calculate', methods=['POST'])
def calculate():
    try:
        data = request.json
        expenses_list = []
        for item in data:
            expenses_list.append(Expense(item['payer'], item['amount'], item['involved']))

        results = calculate_settlements(expenses_list)
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# This is for local testing only
if __name__ == '__main__':
    app.run(debug=True, port=5000)