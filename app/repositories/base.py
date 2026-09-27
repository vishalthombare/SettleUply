from math import ceil
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.exceptions import AppError
from app.models import Category, PaymentMethod


class Repository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def owned(self, model, resource_id: int, user_id: int, *, lock=False, owner_field='user_id'):
        query = select(model).where(model.id == resource_id, getattr(model, owner_field) == user_id)
        if hasattr(model, 'deleted_at'):
            query = query.where(model.deleted_at.is_(None))
        if lock:
            query = query.with_for_update()
        obj = await self.db.scalar(query)
        if obj is None:
            raise AppError(404, 'Resource not found')
        return obj

    async def catalog(self, model, resource_id, user_id):
        if resource_id is None:
            return None
        obj = await self.db.scalar(select(model).where(model.id == resource_id, model.is_active.is_(True), or_(model.user_id == user_id, model.is_system.is_(True))))
        if obj is None:
            raise AppError(422, 'Invalid category or payment method')
        return obj

    async def financial_references(self, data, user_id):
        await self.catalog(Category, data.category_id, user_id)
        await self.catalog(PaymentMethod, data.payment_method_id, user_id)

    async def page(self, query, page=1, page_size=20):
        total = await self.db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
        items = list((await self.db.scalars(query.offset((page - 1) * page_size).limit(page_size))).all())
        return {'items': items, 'page': page, 'page_size': page_size, 'total': total, 'total_pages': ceil(total / page_size)}
