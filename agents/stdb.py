"""SpacetimeDB HTTP client.

There is no maintained Python SDK for SpacetimeDB 2.x, so we speak the HTTP
API directly:

  * reads  -- POST /v1/database/<db>/sql          (body: a SQL string)
  * writes -- POST /v1/database/<db>/call/<name>  (body: a JSON array of args)
  * auth   -- POST /v1/identity                   (anonymous identity + token)

The SQL endpoint answers with positional rows plus a schema, and encodes
sum types as ``[tag_index, value]``. `rows_to_dicts` turns that back into
snake_case dicts so the rest of the code never sees the wire format.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

import config


class StdbError(RuntimeError):
    """SpacetimeDB was unreachable, rejected us, or a reducer threw."""


def _headers(content_type: str) -> dict[str, str]:
    headers = {"Content-Type": content_type}
    if config.STDB_TOKEN:
        headers["Authorization"] = f"Bearer {config.STDB_TOKEN}"
    return headers


def _base() -> str:
    return f"{config.STDB_URL}/v1/database/{config.STDB_DATABASE}"


# ---------------------------------------------------------------------------
# wire-format decoding
# ---------------------------------------------------------------------------


def _element_name(element: dict[str, Any], index: int) -> str:
    name = element.get("name")
    if isinstance(name, dict):
        # {"some": "client_key"} or {"tag": "some", "value": "client_key"}
        return name.get("some") or name.get("value") or f"col{index}"
    if isinstance(name, str):
        return name
    return f"col{index}"


def _is_option(algebraic_type: Any) -> bool:
    variants = (algebraic_type or {}).get("Sum", {}).get("variants")
    if not isinstance(variants, list) or len(variants) != 2:
        return False
    names = [_element_name(v, i) for i, v in enumerate(variants)]
    return names == ["some", "none"]


def _decode(value: Any, algebraic_type: Any) -> Any:
    """Turn one wire value into something ordinary Python code can use."""
    if algebraic_type is None:
        return value

    # Option: [0, inner] is some, [1, []] is none.
    if _is_option(algebraic_type):
        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], int):
            if value[0] != 0:
                return None
            inner = algebraic_type["Sum"]["variants"][0].get("algebraic_type")
            return _decode(value[1], inner)
        return value

    product = (algebraic_type or {}).get("Product")
    if isinstance(product, dict):
        elements = product.get("elements", [])
        # Identity and Timestamp are single-field products; unwrap them.
        if len(elements) == 1:
            name = _element_name(elements[0], 0)
            inner = value[0] if isinstance(value, list) and value else value
            if name.startswith("__"):
                return inner
            return {name: _decode(inner, elements[0].get("algebraic_type"))}
        if isinstance(value, list):
            return {
                _element_name(e, i): _decode(value[i], e.get("algebraic_type"))
                for i, e in enumerate(elements)
                if i < len(value)
            }
        return value

    array = (algebraic_type or {}).get("Array")
    if array is not None and isinstance(value, list):
        return [_decode(v, array) for v in value]

    return value


def rows_to_dicts(result: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten a /sql response into a list of snake_case dicts."""
    out: list[dict[str, Any]] = []
    for statement in result:
        elements = statement.get("schema", {}).get("elements", [])
        names = [_element_name(e, i) for i, e in enumerate(elements)]
        types = [e.get("algebraic_type") for e in elements]
        for row in statement.get("rows", []):
            if isinstance(row, dict):
                out.append(row)
                continue
            out.append(
                {
                    names[i]: _decode(row[i], types[i])
                    for i in range(min(len(names), len(row)))
                }
            )
    return out


# ---------------------------------------------------------------------------
# requests
# ---------------------------------------------------------------------------


async def sql(query: str, *, timeout: float = 20.0) -> list[dict[str, Any]]:
    """Run a read-only SQL query and return decoded rows."""
    url = f"{_base()}/sql"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, headers=_headers("text/plain"), content=query)
    except httpx.RequestError as exc:
        raise StdbError(f"SpacetimeDB unreachable at {url}: {exc}") from exc

    if resp.status_code >= 400:
        raise StdbError(f"sql {resp.status_code}: {resp.text[:300]}")
    try:
        return rows_to_dicts(resp.json())
    except (ValueError, KeyError, TypeError) as exc:
        raise StdbError(f"could not decode sql response: {exc}") from exc


async def call(reducer: str, args: list[Any], *, timeout: float = 30.0) -> None:
    """Call a reducer. Reducers return nothing; failure raises."""
    url = f"{_base()}/call/{reducer}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                url, headers=_headers("application/json"), content=json.dumps(args)
            )
    except httpx.RequestError as exc:
        raise StdbError(f"SpacetimeDB unreachable at {url}: {exc}") from exc

    if resp.status_code == 401:
        raise StdbError(
            f"not authorised to call {reducer}. STDB_TOKEN must be the identity "
            "that owns the profile and video (see agents/README.md)."
        )
    if resp.status_code >= 400:
        raise StdbError(f"{reducer} failed ({resp.status_code}): {resp.text[:300]}")


async def anonymous_identity() -> dict[str, str]:
    """Mint a throwaway identity. Enough to read public tables, not to own rows."""
    url = f"{config.STDB_URL}/v1/identity"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(url, headers={"Content-Type": "application/json"}, content="{}")
    if resp.status_code >= 400:
        raise StdbError(f"identity {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def quote(value: str) -> str:
    """Single-quote a string for SQL. Ids we interpolate are ours, but still."""
    return "'" + value.replace("'", "''") + "'"
