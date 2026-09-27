from collections import defaultdict
from decimal import Decimal
from sqlalchemy import select, func, delete
from app.models import Group, GroupMember, GroupExpense, ExpenseSplit, Contact, User
from app.models.enums import SplitType, UserStatus
from app.repositories.base import Repository
from app.services.transactions import validate_precision
from app.schemas.inputs import CURRENCY_DIGITS
from app.exceptions import AppError
from app.db.base import utcnow
from app.utils.serialization import serialize


class GroupSplitService:
    @staticmethod
    def calculate(amount, currency, split_type, splits):
        validate_precision(amount, currency)
        ids = sorted(s.group_member_id for s in splits)
        if not ids or len(ids) != len(set(ids)):
            raise AppError(422, 'Choose unique members')
        if split_type == SplitType.EQUAL:
            quantum = Decimal(1).scaleb(-CURRENCY_DIGITS[currency])
            units = int(amount / quantum)
            base, remainder = divmod(units, len(ids))
            return {member_id: Decimal(base + (1 if index < remainder else 0)) * quantum for index, member_id in enumerate(ids)}
        result = {}
        for split in splits:
            if split.share_amount is None:
                raise AppError(422, 'Enter an exact share for every member')
            validate_precision(split.share_amount, currency)
            result[split.group_member_id] = split.share_amount
        if sum(result.values(), Decimal('0')) != amount:
            raise AppError(422, 'Exact shares must equal the expense amount')
        return result


class GroupService(Repository):
    def visible(self, user_id):
        membership = select(GroupMember.group_id).where(GroupMember.user_id == user_id, GroupMember.is_active.is_(True))
        return select(Group).where((Group.owner_user_id == user_id) | Group.id.in_(membership))

    async def access(self, user_id, group_id, *, write=False, lock=False):
        query = self.visible(user_id).where(Group.id == group_id)
        group = await self.db.scalar(query.with_for_update() if lock else query)
        if group is None:
            raise AppError(404, 'Group not found')
        if write and group.owner_user_id != user_id:
            raise AppError(403, 'Only the group owner can change this group')
        if write and not group.is_active:
            raise AppError(409, 'Group is archived')
        return group

    async def list(self, user_id, page, page_size, search=None):
        query = self.visible(user_id).where(Group.is_active.is_(True))
        if search:
            query = query.where(Group.name.ilike(f'%{search}%'))
        result = await self.page(query.order_by(Group.id.desc()), page, page_size)
        items = []
        for group in result['items']:
            item = serialize(group)
            item['member_count'] = await self.db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group.id, GroupMember.is_active.is_(True)))
            item['expense_count'] = await self.db.scalar(select(func.count()).select_from(GroupExpense).where(GroupExpense.group_id == group.id, GroupExpense.deleted_at.is_(None)))
            items.append(item)
        result['items'] = items
        return result

    async def save(self, user, data, group_id=None):
        group = await self.access(user.id, group_id, write=True, lock=True) if group_id else Group(owner_user_id=user.id)
        for key, value in data.model_dump().items():
            setattr(group, key, value)
        self.db.add(group)
        await self.db.flush()
        if group_id is None:
            self.db.add(GroupMember(group_id=group.id, user_id=user.id, display_name=user.name, email=user.email, phone=user.phone))
        await self.db.commit()
        return group

    async def archive(self, user_id, group_id):
        group = await self.access(user_id, group_id, write=True, lock=True)
        group.is_active = False
        await self.db.commit()

    async def members(self, user_id, group_id, page, page_size):
        await self.access(user_id, group_id)
        return await self.page(select(GroupMember).where(GroupMember.group_id == group_id).order_by(GroupMember.id), page, page_size)

    async def save_member(self, user_id, group_id, data, member_id=None):
        group = await self.access(user_id, group_id, write=True, lock=True)
        if data.contact_id and data.registered_email:
            raise AppError(422, 'Choose a contact or a registered email')
        obj = await self.db.scalar(select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id)) if member_id else GroupMember(group_id=group_id)
        if obj is None:
            raise AppError(404, 'Member not found')
        linked_id = obj.user_id if member_id else None
        if data.registered_email:
            linked = await self.db.scalar(select(User).where(User.email == str(data.registered_email).lower(), User.status == UserStatus.ACTIVE))
            if not linked:
                raise AppError(422, 'Cannot add this registered member')
            linked_id = linked.id
        if data.contact_id:
            contact = await self.owned(Contact, data.contact_id, user_id)
            if not contact.is_active:
                raise AppError(409, 'Contact is archived')
        if member_id and (obj.user_id != linked_id or obj.contact_id != data.contact_id):
            raise AppError(409, 'Member identity cannot change; add a new member')
        if member_id and obj.user_id == group.owner_user_id and not data.is_active:
            raise AppError(409, 'Cannot remove the group owner')
        if not member_id:
            count = await self.db.scalar(select(func.count()).select_from(GroupMember).where(GroupMember.group_id == group_id))
            if count >= 200:
                raise AppError(409, 'V1 groups support up to 200 members')
        duplicate = select(GroupMember).where(GroupMember.group_id == group_id, func.lower(GroupMember.display_name) == data.display_name.lower())
        if member_id:
            duplicate = duplicate.where(GroupMember.id != member_id)
        if await self.db.scalar(duplicate):
            raise AppError(409, 'A member with this name already exists')
        for key, value in data.model_dump(exclude={'registered_email'}).items():
            setattr(obj, key, value)
        obj.user_id = linked_id
        self.db.add(obj)
        await self.db.commit()
        return obj

    async def remove_member(self, user_id, group_id, member_id):
        group = await self.access(user_id, group_id, write=True, lock=True)
        member = await self.db.scalar(select(GroupMember).where(GroupMember.id == member_id, GroupMember.group_id == group_id))
        if member is None:
            raise AppError(404, 'Member not found')
        if member.user_id == group.owner_user_id:
            raise AppError(409, 'Cannot remove the group owner')
        # Archive preserves all payer/split references and historic balances.
        member.is_active = False
        await self.db.commit()

    async def expense_detail(self, user_id, group_id, expense_id):
        await self.access(user_id, group_id)
        expense = await self.db.scalar(select(GroupExpense).where(GroupExpense.id == expense_id, GroupExpense.group_id == group_id, GroupExpense.deleted_at.is_(None)))
        if expense is None:
            raise AppError(404, 'Expense not found')
        result = serialize(expense)
        result['splits'] = list((await self.db.scalars(select(ExpenseSplit).where(ExpenseSplit.group_expense_id == expense.id).order_by(ExpenseSplit.group_member_id))).all())
        return result

    async def expenses(self, user_id, group_id, page, page_size):
        await self.access(user_id, group_id)
        return await self.page(select(GroupExpense).where(GroupExpense.group_id == group_id, GroupExpense.deleted_at.is_(None)).order_by(GroupExpense.expense_date.desc(), GroupExpense.id.desc()), page, page_size)

    async def save_expense(self, user_id, group_id, data, expense_id=None, preview=False):
        await self.access(user_id, group_id, write=True, lock=True)
        await self.financial_references(data, user_id)
        active = set((await self.db.scalars(select(GroupMember.id).where(GroupMember.group_id == group_id, GroupMember.is_active.is_(True)))).all())
        shares = GroupSplitService.calculate(data.amount, data.currency, data.split_type, data.splits)
        if data.paid_by_member_id not in active or not set(shares).issubset(active):
            raise AppError(422, 'Payer and split members must be active members of this group')
        if preview:
            return [{'group_member_id': key, 'share_amount': value} for key, value in shares.items()]
        expense = await self.db.scalar(select(GroupExpense).where(GroupExpense.id == expense_id, GroupExpense.group_id == group_id, GroupExpense.deleted_at.is_(None)).with_for_update()) if expense_id else GroupExpense(group_id=group_id, created_by_user_id=user_id)
        if expense is None:
            raise AppError(404, 'Expense not found')
        if expense_id:
            if await self.db.scalar(select(func.count()).select_from(ExpenseSplit).where(ExpenseSplit.group_expense_id == expense_id, ExpenseSplit.settled_amount > 0)):
                raise AppError(409, 'Settled expense cannot be edited')
            await self.db.execute(delete(ExpenseSplit).where(ExpenseSplit.group_expense_id == expense_id))
        for key, value in data.model_dump(exclude={'splits'}).items():
            setattr(expense, key, value)
        self.db.add(expense)
        await self.db.flush()
        for member_id, amount in shares.items():
            self.db.add(ExpenseSplit(group_expense_id=expense.id, group_member_id=member_id, share_amount=amount, settled_amount=Decimal('0')))
        await self.db.commit()
        return await self.expense_detail(user_id, group_id, expense.id)

    async def delete_expense(self, user_id, group_id, expense_id):
        await self.access(user_id, group_id, write=True, lock=True)
        expense = await self.db.scalar(select(GroupExpense).where(GroupExpense.id == expense_id, GroupExpense.group_id == group_id, GroupExpense.deleted_at.is_(None)).with_for_update())
        if expense is None:
            raise AppError(404, 'Expense not found')
        if await self.db.scalar(select(func.count()).select_from(ExpenseSplit).where(ExpenseSplit.group_expense_id == expense_id, ExpenseSplit.settled_amount > 0)):
            raise AppError(409, 'Settled expense cannot be deleted')
        expense.deleted_at = utcnow()
        await self.db.commit()

    async def balances(self, user_id, group_id):
        await self.access(user_id, group_id)
        balances = defaultdict(lambda: defaultdict(lambda: Decimal('0')))
        rows = (await self.db.execute(select(GroupExpense.paid_by_member_id, GroupExpense.currency, ExpenseSplit.group_member_id, func.sum(ExpenseSplit.share_amount - ExpenseSplit.settled_amount)).join(ExpenseSplit, ExpenseSplit.group_expense_id == GroupExpense.id).where(GroupExpense.group_id == group_id, GroupExpense.deleted_at.is_(None)).group_by(GroupExpense.paid_by_member_id, GroupExpense.currency, ExpenseSplit.group_member_id))).all()
        for payer, currency, member, amount in rows:
            if payer != member:
                balances[currency][payer] += amount
                balances[currency][member] -= amount
        return {currency: dict(members) for currency, members in balances.items()}
