.PHONY: help install dev test test-all test-unit test-integration test-coverage lint format clean run db-init db-main-check db-sensor-check db-main-stamp db-sensor-stamp db-main-upgrade db-sensor-upgrade db-revision-main db-revision-sensor migrate

# Default target
help:
	@echo "🚀 Majiscope Backend - Common Commands"
	@echo "======================================"
	@echo ""
	@echo "Setup & Dependencies:"
	@echo "  make install        - Install dependencies"
	@echo "  make install-dev    - Install dev dependencies"
	@echo ""
	@echo "Development:"
	@echo "  make dev            - Run development server with auto-reload"
	@echo "  make run            - Run production server"
	@echo ""
	@echo "Testing:"
	@echo "  make test           - Run all tests"
	@echo "  make test-unit      - Run unit tests only"
	@echo "  make test-integration - Run integration tests only"
	@echo "  make test-coverage  - Run tests with coverage report"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint           - Run code linter (flake8)"
	@echo "  make format         - Format code (black)"
	@echo "  make clean          - Clean up generated files"
	@echo ""
	@echo "Database:"
	@echo "  make db-init        - Create current main and sensor schemas from ORM metadata"
	@echo "  make db-main-check  - Compare the live main schema with model metadata (read-only)"
	@echo "  make db-sensor-check - Compare the live sensor schema with model metadata (read-only)"
	@echo "  make db-main-stamp  - Stamp an already-verified main schema at the baseline"
	@echo "  make db-sensor-stamp - Stamp an already-verified sensor schema at the baseline"
	@echo "  make db-main-upgrade - Upgrade the main database through reviewed Alembic revisions"
	@echo "  make db-sensor-upgrade - Upgrade the sensor database through reviewed Alembic revisions"
	@echo "  make db-revision-main - Autogenerate a main database revision for review"
	@echo "  make db-revision-sensor - Autogenerate a sensor database revision for review"
	@echo "  make migrate        - Upgrade both databases (controlled deploy job only)"
	@echo "  make db-seed        - Seed database with test data"
	@echo ""

install:
	pip install -r requirements.txt

install-dev:
	pip install -r requirements.txt
	pip install black flake8 isort

dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

run:
	uvicorn app.main:app --host 0.0.0.0 --port 8000

test:
	pytest tests/ -v

test-unit:
	pytest tests/ -v -m "not integration"

test-integration:
	pytest tests/test_integration.py -v

test-coverage:
	pytest tests/ --cov=app --cov-report=html --cov-report=term-missing
	@echo "📊 Coverage report generated in htmlcov/index.html"

lint:
	flake8 app tests --max-line-length=120 --exclude=__pycache__

format:
	black app tests --line-length=120
	isort app tests

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache/
	rm -rf htmlcov/
	rm -rf .coverage

migrate:
	alembic -c alembic.ini upgrade head
	alembic -c alembic.sensor.ini upgrade head

db-init:
	python init_db.py

db-main-check:
	python scripts/verify_schema.py main

db-sensor-check:
	python scripts/verify_schema.py sensor

db-main-stamp:
	python scripts/stamp_baseline.py main

db-sensor-stamp:
	python scripts/stamp_baseline.py sensor

db-main-upgrade:
	alembic -c alembic.ini upgrade head

db-sensor-upgrade:
	alembic -c alembic.sensor.ini upgrade head

db-revision-main:
	alembic -c alembic.ini revision --autogenerate -m "$(message)"

db-revision-sensor:
	alembic -c alembic.sensor.ini revision --autogenerate -m "$(message)"

db-seed:
	python -m app.prisma.seed
