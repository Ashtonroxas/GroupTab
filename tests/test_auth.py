from flask import Flask, jsonify

from api import auth as auth_module


def test_localhost_requests_are_allowed_without_server_auth(monkeypatch):
    app = Flask(__name__)

    monkeypatch.delenv('FLASK_ENV', raising=False)
    monkeypatch.delenv('FIREBASE_PROJECT_ID', raising=False)
    monkeypatch.delenv('X_API_KEY', raising=False)
    monkeypatch.delenv('FIREBASE_SERVICE_ACCOUNT_JSON', raising=False)
    monkeypatch.delenv('FIREBASE_SERVICE_ACCOUNT_FILE', raising=False)
    auth_module._FIREBASE_AVAILABLE = False
    auth_module._firebase_auth = None

    @app.route('/ping')
    @auth_module.require_auth
    def ping():
        return jsonify({'ok': True}), 200

    with app.test_request_context('/ping', base_url='http://localhost:5173'):
        response = ping()

    assert response[1] == 200
    assert response[0].json == {'ok': True}
