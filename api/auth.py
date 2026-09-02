import os
import json
import logging
from functools import wraps
from flask import request, jsonify

# Optional firebase-admin import (may be absent in dev/test)
try:
    import firebase_admin
    from firebase_admin import credentials as firebase_credentials
    from firebase_admin import auth as firebase_admin_auth
    _FIREBASE_INSTALLED = True
except Exception:
    firebase_admin = None
    firebase_credentials = None
    firebase_admin_auth = None
    _FIREBASE_INSTALLED = False

logger = logging.getLogger(__name__)

# Holds runtime state after init
_FIREBASE_AVAILABLE = False
_firebase_auth = None


def init_auth(app_logger=None):
    """Initialize Firebase Admin SDK if service account JSON is provided.

    Returns True if Firebase Admin was initialized and token verification is available.
    """
    global _FIREBASE_AVAILABLE, _firebase_auth
    if app_logger:
        # allow using the main app logger
        global logger
        logger = app_logger

    service_account_json = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
    if service_account_json and _FIREBASE_INSTALLED:
        try:
            sa = json.loads(service_account_json)
            cred = firebase_credentials.Certificate(sa)
            firebase_admin.initialize_app(cred)
            _firebase_auth = firebase_admin_auth
            _FIREBASE_AVAILABLE = True
            logger.info('Firebase Admin initialized for token verification')
            return True
        except Exception as e:
            logger.error(
                f'Failed to initialize Firebase Admin: {e}', exc_info=True)
            _FIREBASE_AVAILABLE = False
            return False

    if not _FIREBASE_INSTALLED:
        logger.warning(
            'firebase-admin not installed; token verification disabled')
    else:
        logger.warning(
            'FIREBASE_SERVICE_ACCOUNT_JSON not set; token verification disabled')

    _FIREBASE_AVAILABLE = False
    return False


def require_auth(f):
    """Decorator to require authentication for endpoints.

    Behavior:
    - If FLASK_ENV=development, skips auth for convenience.
    - If Firebase Admin was initialized, expects `Authorization: Bearer <id_token>` and verifies it.
    - Otherwise falls back to checking `X-API-KEY` environment variable.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # Allow local development without tokens
        if os.getenv('FLASK_ENV') == 'development':
            return f(*args, **kwargs)

        # Prefer Firebase ID token verification
        if _FIREBASE_AVAILABLE and _firebase_auth:
            auth_header = request.headers.get('Authorization', None)
            if not auth_header or not auth_header.startswith('Bearer '):
                return jsonify({'error': 'Authorization header missing'}), 401
            id_token = auth_header.split(' ', 1)[1]
            try:
                decoded = _firebase_auth.verify_id_token(id_token)
                # Attach user info to request for downstream use
                request.user = decoded
                return f(*args, **kwargs)
            except Exception as e:
                logger.warning(f'Invalid Firebase token: {e}')
                return jsonify({'error': 'Invalid or expired token'}), 401

        # Fallback to static API key if configured
        api_key = os.getenv('X_API_KEY')
        if api_key:
            provided = request.headers.get(
                'X-API-KEY') or request.args.get('api_key')
            if provided and provided == api_key:
                return f(*args, **kwargs)
            logger.warning('Invalid or missing API key')
            return jsonify({'error': 'Invalid or missing API key'}), 401

        logger.error('No authentication mechanism configured')
        return jsonify({'error': 'Authentication not configured on server'}), 500

    return decorated
