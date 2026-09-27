from typing import Annotated
from fastapi import APIRouter, Query, Depends
from app.api.dependencies import DB, CurrentUser
from app.schemas.inputs import ContactInput, CatalogInput, PageParams
from app.services.catalogs import ContactService, CatalogService
from app.services.ledger import LedgerService
from app.models import Contact, Category, PaymentMethod
from app.utils.serialization import ok

router = APIRouter(tags=['contacts'])


@router.get('/contacts')
async def contacts(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()], search: str | None = None, active: bool | None = True, balance_filter: str | None = None):
    return ok(await ContactService(db).list(user.id, pagination.page, pagination.page_size, search, active, balance_filter))


@router.post('/contacts', status_code=201)
async def add(data: ContactInput, db: DB, user: CurrentUser):
    return ok(await ContactService(db).save(user.id, data))


@router.get('/contacts/{resource_id}')
async def detail(resource_id: int, db: DB, user: CurrentUser):
    return ok(await ContactService(db).owned(Contact, resource_id, user.id))


@router.patch('/contacts/{resource_id}')
async def edit(resource_id: int, data: ContactInput, db: DB, user: CurrentUser):
    return ok(await ContactService(db).save(user.id, data, resource_id))


@router.delete('/contacts/{resource_id}')
async def archive(resource_id: int, db: DB, user: CurrentUser):
    await ContactService(db).archive(user.id, resource_id)
    return ok(message='Contact archived')


@router.get('/contacts/{resource_id}/ledger')
async def ledger(resource_id: int, db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
    return ok(await LedgerService(db).contact(user.id, resource_id, pagination.page, pagination.page_size))


def catalog_routes(path, model):
    async def listing(db: DB, user: CurrentUser, pagination: Annotated[PageParams, Depends()]):
        return ok(await CatalogService(db).list(model, user.id, pagination.page, pagination.page_size))
    async def create(data: CatalogInput, db: DB, user: CurrentUser):
        return ok(await CatalogService(db).save(model, user.id, data))
    async def update(resource_id: int, data: CatalogInput, db: DB, user: CurrentUser):
        return ok(await CatalogService(db).save(model, user.id, data, resource_id))
    async def remove(resource_id: int, db: DB, user: CurrentUser):
        await CatalogService(db).archive(model, user.id, resource_id)
        return ok(message='Archived')
    for suffix, endpoint, methods, code in [('', listing, ['GET'], 200), ('', create, ['POST'], 201), ('/{resource_id}', update, ['PATCH'], 200), ('/{resource_id}', remove, ['DELETE'], 200)]:
        router.add_api_route(path + suffix, endpoint, methods=methods, status_code=code, tags=[path[1:]], name=f'{methods[0]}_{path[1:]}')


catalog_routes('/categories', Category)
catalog_routes('/payment-methods', PaymentMethod)
