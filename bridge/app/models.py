"""Bridge data models — maps your product's tenants/users to ContextForge."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class TenantCFMapping(Base):
    """Maps your product's tenant/org to a ContextForge Team."""

    __tablename__ = "tenant_cf_mapping"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    your_tenant_id = Column(Text, unique=True, nullable=False, index=True)
    cf_team_id = Column(Text, nullable=True)  # Populated after CF Team creation
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    users = relationship("EndUserCFMapping", back_populates="tenant", cascade="all, delete-orphan")
    connections = relationship(
        "ToolkitConnection",
        secondary="end_user_cf_mapping",
        viewonly=True,
    )


class EndUserCFMapping(Base):
    """Maps your product's user to a ContextForge user identity."""

    __tablename__ = "end_user_cf_mapping"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    your_user_id = Column(Text, nullable=False, index=True)
    tenant_cf_mapping_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenant_cf_mapping.id", ondelete="CASCADE"),
        nullable=False,
    )
    cf_user_email = Column(Text, nullable=True)  # Identity CF tracks per-user OAuth tokens against
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # Relationships
    tenant = relationship("TenantCFMapping", back_populates="users")
    connections = relationship("ToolkitConnection", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("your_user_id", "tenant_cf_mapping_id", name="uq_user_tenant"),
    )


class ToolkitConnection(Base):
    """Cache of connection status per (user, toolkit) — avoids polling CF on every page load."""

    __tablename__ = "toolkit_connections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    end_user_cf_mapping_id = Column(
        UUID(as_uuid=True),
        ForeignKey("end_user_cf_mapping.id", ondelete="CASCADE"),
        nullable=False,
    )
    toolkit_slug = Column(Text, nullable=False)  # e.g. "notion", "github"
    cf_gateway_id = Column(Text, nullable=True)  # Registered gateway ID in ContextForge
    status = Column(
        Text,
        nullable=False,
        default="not_connected",
    )
    last_synced_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("EndUserCFMapping", back_populates="connections")

    __table_args__ = (
        UniqueConstraint("end_user_cf_mapping_id", "toolkit_slug", name="uq_user_toolkit"),
        CheckConstraint(
            "status IN ('not_connected', 'connecting', 'connected', 'error', 'revoked')",
            name="ck_toolkit_status",
        ),
    )
