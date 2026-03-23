import os
from flask import Flask
from .database import init_db, close_db


def create_app():
    app = Flask(__name__)
    app.config["DATABASE"] = os.path.join(app.instance_path, "uns_modeler.db")

    os.makedirs(app.instance_path, exist_ok=True)

    # Register teardown
    app.teardown_appcontext(close_db)

    # Init DB tables
    init_db(app)

    # Blueprints
    from .routes.main import main_bp
    from .routes.use_cases import use_cases_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(use_cases_bp)

    return app