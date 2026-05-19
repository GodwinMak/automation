# Customer Search API

Search for customers across DIA, IPT, and Shared service types by name, CID, interface, neighbor, email, or phone number.

**Base URL:** `https://automation.liquidmatics.co.tz`

---

## Authentication

The system uses **JWT Bearer tokens**. Most endpoints require the token; the `/search` endpoint is currently public (no middleware guard), but you should always include the token for forward compatibility and to avoid being rejected if the route is secured later.

### Step 1 — Obtain a token

```http
POST https://automation.liquidmatics.co.tz/users/login
Content-Type: application/json

{
  "email": "you@liquidtech.co.tz",
  "password": "yourpassword"
}
```

**Response `200 OK`:**

```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid-...",
    "username": "yourname",
    "email": "you@liquidtech.co.tz",
    "role": "admin",
    "permissions": { ... }
  }
}
```

Tokens expire after **24 hours** (except the NOC monitoring account, which has no expiry).

### Step 2 — Pass the token in every request

Add the token to the `Authorization` header as a Bearer token:

```
Authorization: Bearer <token>
```

#### Login error responses

| Status | Body                                                         | Reason                    |
|--------|--------------------------------------------------------------|---------------------------|
| `404`  | `{ "message": "User not found" }`                            | Email does not exist      |
| `401`  | `{ "message": "Invalid password" }`                          | Wrong password            |
| `403`  | `{ "message": "Account is deactivated. Contact administrator." }` | Account disabled    |

---

## `GET /search`

Returns a list of customers matching the search query.

### Query Parameters

| Parameter | Type    | Required | Default | Description                                       |
|-----------|---------|----------|---------|---------------------------------------------------|
| `q`       | string  | Yes      | —       | Search term (minimum 2 characters)                |
| `limit`   | integer | No       | `10`    | Max results **per service type** (DIA, IPT, Shared). Total returned can be up to `limit × 2`. |

### Searchable Fields

The query is matched (case-insensitive, partial match) against:

- `customerName`
- `cid` (Circuit ID)
- `interface`
- `nbr` (Neighbor/switch)
- `email_address` (from billing records)
- `phone_number` (from billing records)
- `customer_name_pastel` (from billing records)

---

### Example Request

```http
GET https://automation.liquidmatics.co.tz/search?q=liquid&limit=10
```

---

### Response `200 OK`

```json
{
  "results": [
    {
      "id": "a1b2c3d4-...",
      "customerName": "Liquid Telecom",
      "cid": "LIQ-00123",
      "interface": "ge-0/0/10.100",
      "nbr": "10.169.1.1",
      "status": "up",
      "switchName": "SW-DAR-01",
      "type": "DIA",
      "route": "/viewcustomer",
      "data": { ... }
    },
    {
      "id": "e5f6g7h8-...",
      "customerName": "Liquid Solutions",
      "cid": "LIQ-00456",
      "interface": "xe-0/0/2.200",
      "nbr": "10.169.2.5",
      "status": "down",
      "switchName": "SW-DAR-02",
      "type": "IPT",
      "route": "/view-ipt-customer",
      "data": { ... }
    }
  ],
  "total": 2,
  "query": "liquid"
}
```

---

### Response Fields

#### Top-level

| Field    | Type    | Description                                              |
|----------|---------|----------------------------------------------------------|
| `results`| array   | Matched customer records (sorted: exact matches first)  |
| `total`  | integer | Total number of matches before the limit was applied     |
| `query`  | string  | The search term that was used                            |

#### Each `result` object

| Field          | Type   | Description                                                           |
|----------------|--------|-----------------------------------------------------------------------|
| `id`           | UUID   | Unique customer record identifier                                     |
| `customerName` | string | Customer display name                                                 |
| `cid`          | string | Circuit ID (may be `null`)                                            |
| `interface`    | string | Router interface (e.g. `ge-0/0/10.100`)                              |
| `nbr`          | string | Neighbor / switch IP the customer is connected through                |
| `status`       | string | Link state: `"up"`, `"down"`, or `"unknown"`                         |
| `switchName`   | string | Human-readable switch name (e.g. `"SW-DAR-01"`)                      |
| `type`         | string | Service type: `"DIA"`, `"IPT"`, or `"Shared"`                        |
| `route`        | string | Frontend route for navigation (`/viewcustomer`, `/view-ipt-customer`, `/view-shared-customer`) |
| `data`         | object | Full customer record (see **Expanded `data` object** below)           |

---

### Expanded `data` Object

The `data` field contains the raw database record with all available fields.

#### Core fields (all types)

| Field          | Type    | Description                               |
|----------------|---------|-------------------------------------------|
| `id`           | UUID    | Record ID                                 |
| `customerName` | string  | Customer name                             |
| `cid`          | string  | Circuit ID                                |
| `interface`    | string  | Router interface                          |
| `nbr`          | string  | Neighbor switch                           |
| `port`         | string  | Physical port (e.g. `xe-0/0/0`)          |
| `upmbps`       | integer | Upload capacity (Mbps)                    |
| `downmbps`     | integer | Download capacity (Mbps)                  |
| `old_upmbps`   | integer | Previous upload capacity (before upgrade) |
| `old_downmbps` | integer | Previous download capacity                |
| `expires_at`   | date    | Temporary upgrade expiry (`null` if permanent) |
| `upgrade_type` | string  | `"permanent"` \| `"temporary"` \| `null` |

#### Nested service record (`diacustomer` / `iptcustomer` / `sharedcustomer`)

| Field               | Type   | Description                          |
|---------------------|--------|--------------------------------------|
| `operationalStatus` | string | `"up"` or `"down"`                   |
| `switchName`        | string | Switch name                          |

#### Nested billing record (`client_db`) — may be `null`

| Field                      | Type    | Description                       |
|----------------------------|---------|-----------------------------------|
| `customer_name_pastel`     | string  | Billing system name               |
| `customer_other_name_pastel` | string | Alternative billing name         |
| `first_name`               | string  | Contact first name                |
| `phone_number`             | string  | Contact phone                     |
| `email_address`            | string  | Contact email                     |
| `area`                     | string  | Service area / region             |
| `new_customer_type`        | string  | Customer category                 |
| `special_comments`         | string  | Internal notes                    |
| `medium_details`           | string  | Connection medium details         |
| `revenue_head`             | string  | Revenue classification            |
| `mbps_seats`               | integer | Subscribed seat count (IPT)       |

---

### Sorting

Results are sorted so that customers whose name **starts with** the query appear first. Ties between service types retain database order.

---

### Error Responses

| Status | Body                                                     | Cause                         |
|--------|----------------------------------------------------------|-------------------------------|
| `200`  | `{ "results": [] }`                                      | Query shorter than 2 chars    |
| `500`  | `{ "message": "Search failed", "error": "<detail>" }`   | Internal server / DB error    |

---

### Quick Test

```bash
# 1. Login and capture the token
TOKEN=$(curl -s -X POST https://automation.liquidmatics.co.tz/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@liquidtech.co.tz","password":"yourpassword"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Search by customer name
curl -H "Authorization: Bearer $TOKEN" \
  "https://automation.liquidmatics.co.tz/search?q=john&limit=5"

# 3. Search by phone number
curl -H "Authorization: Bearer $TOKEN" \
  "https://automation.liquidmatics.co.tz/search?q=0712345678&limit=5"

# 4. Search by circuit ID
curl -H "Authorization: Bearer $TOKEN" \
  "https://automation.liquidmatics.co.tz/search?q=LIQ-001&limit=10"
```
