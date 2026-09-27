"""Server-owned audit metadata for ORM inserts, edits, and bulk updates."""
from sqlalchemy import event, inspect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, ORMExecuteState
from app.core.audit import ApplicationType
from app.db.base import AuditMixin, utcnow
from app.exceptions import AppError

CREATION_FIELDS = {'created_at', 'created_by', 'created_application_type'}


def set_request_audit(session: AsyncSession, application_type: str | None) -> None:
    """Treat source as client metadata, never as identity or authorization."""
    source = application_type.strip().upper() if application_type else 'UNKNOWN'
    if source not in {'WEB', 'MOBILE', 'UNKNOWN'}:
        raise AppError(422, 'X-Application-Type must be WEB or MOBILE')
    session.info['audit_application_type'] = ApplicationType(source)
    session.info['audit_actor_id'] = None


def set_audit_actor(session: AsyncSession, user_id: int) -> None:
    """Call only after JWT, password, OTP, or refresh credentials are verified."""
    session.info['audit_actor_id'] = user_id


def update_audit_values(session: Session) -> dict:
    return {
        'updated_at': utcnow(),
        'updated_by': session.info.get('audit_actor_id'),
        'updated_application_type': session.info.get('audit_application_type', ApplicationType.SYSTEM),
    }


@event.listens_for(Session, 'before_flush')
def stamp_audit_fields(session: Session, flush_context, instances) -> None:
    values = update_audit_values(session)
    for record in session.new:
        if not isinstance(record, AuditMixin):
            continue
        # Never accept caller-supplied audit fields on a new record.
        record.created_at = values['updated_at']
        record.created_by = values['updated_by']
        record.created_application_type = values['updated_application_type']
        for field, value in values.items():
            setattr(record, field, value)

    for record in session.dirty:
        if not isinstance(record, AuditMixin) or not session.is_modified(record, include_collections=False):
            continue
        state = inspect(record)
        if any(state.attrs[field].history.has_changes() for field in CREATION_FIELDS):
            raise ValueError('Creation audit fields cannot be changed')
        for field, value in values.items():
            setattr(record, field, value)


@event.listens_for(Session, 'do_orm_execute')
def stamp_bulk_updates(state: ORMExecuteState) -> None:
    # Session/OTP revocation uses UPDATE statements rather than loaded ORM rows.
    mapper = state.bind_mapper
    if not state.is_update or mapper is None or not issubclass(mapper.class_, AuditMixin):
        return
    if CREATION_FIELDS.intersection(state.statement.compile().params):
        raise ValueError('Creation audit fields cannot be changed')
    state.statement = state.statement.values(**update_audit_values(state.session))
