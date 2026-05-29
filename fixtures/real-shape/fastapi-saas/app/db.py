"""Database engine and session dependency."""
import os
from collections.abc import Generator

from sqlmodel import Session, create_engine

engine = create_engine(os.environ.get("DATABASE_URL", "sqlite:///./app.db"))


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
