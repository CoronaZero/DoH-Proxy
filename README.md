# DoH Proxy

A lightweight **DNS-over-HTTPS (DoH) proxy** built on Cloudflare Workers.

This project provides a simple way to expose multiple public DoH providers through a single Cloudflare Worker endpoint. It also includes a built-in web interface for testing DNS resolution and inspecting `A`, `AAAA`, and `CNAME` records.

## Features

* DNS-over-HTTPS proxy powered by Cloudflare Workers
* Multiple upstream DoH providers
* One unified URL structure for all providers
* Supports both `GET` and `POST` DoH requests
* CORS support
* Built-in DNS query interface
* Query `A`, `AAAA`, and `CNAME` records
* Query all three record types simultaneously
* Displays DNS response codes and query latency
* No external database or storage required
* Provider list is generated automatically from the `routes` configuration
* Configurable secret path

## Supported Providers

The default configuration includes:

| Provider                 | Description                              |
| ------------------------ | ---------------------------------------- |
| Cloudflare               | Standard Cloudflare Public DNS           |
| Cloudflare Security      | Cloudflare malware/security filtering    |
| Cloudflare Family        | Cloudflare family filtering              |
| Google Public DNS        | Google Public DNS                        |
| Quad9                    | Quad9 security-focused DNS               |
| AdGuard                  | AdGuard DNS with ad and tracker blocking |
| AdGuard Unfiltered       | AdGuard DNS without filtering            |
| AdGuard Family           | AdGuard family filtering                 |
| OpenDNS                  | Cisco OpenDNS                            |
| Control D                | Control D unfiltered DNS                 |
| Control D Malware        | Control D malware filtering              |
| Control D Ads & Trackers | Control D ad and tracker filtering       |
| Control D Social         | Control D social media filtering         |
| Control D Family         | Control D family filtering               |
| Control D Uncensored     | Control D uncensored DNS                 |

The available providers are defined in the `routes` object in `worker.js`.

## Architecture

The Worker acts as a simple reverse proxy between clients and upstream DoH resolvers:

```text
Client
  │
  │ DNS-over-HTTPS
  ▼
Cloudflare Worker
  │
  ├── Cloudflare DNS
  ├── Google Public DNS
  ├── Quad9
  ├── AdGuard DNS
  ├── OpenDNS
  └── Control D
```

The Worker does not perform recursive DNS resolution itself. It forwards DNS queries to the selected upstream provider and returns the upstream response.

## Configuration

The main configuration is located at the beginning of `worker.js`.

### Secret Path

```javascript
const SECRET_PATH_NAME = "doh-path";
```

This variable controls the URL prefix used by the proxy.

For example, with:

```javascript
const SECRET_PATH_NAME = "doh-path";
```

the proxy endpoints are:

```text
/doh-path/cf
/doh-path/google
/doh-path/quad9
/doh-path/adg
```

Changing the variable automatically changes the path used by the Worker.

For example:

```javascript
const SECRET_PATH_NAME = "dns";
```

will change the endpoints to:

```text
/dns/cf
/dns/google
/dns/quad9
/dns/adg
```

The web query interface also follows this value automatically.

### Upstream Providers

Providers are configured using a simple key-to-URL mapping:

```javascript
const routes = {
  "cf": "https://cloudflare-dns.com/dns-query",
  "google": "https://dns.google/dns-query",
  "quad9": "https://dns.quad9.net/dns-query",
};
```

To add another DoH provider, add a new entry:

```javascript
"example": "https://example.com/dns-query",
```

The provider will automatically become available to the proxy.

## DoH Proxy API

### GET

A standard DoH GET request can be sent to:

```text
/<SECRET_PATH_NAME>/<provider>?dns=<base64url_dns_message>
```

For example:

```text
/doh-path/cf?dns=...
```

The Worker forwards the request to the selected upstream DoH resolver.

### POST

DoH POST requests use the standard DNS wire format:

```http
POST /doh-path/cf
Content-Type: application/dns-message
Accept: application/dns-message
```

The request body should contain a DNS wire-format message.

The response is returned as:

```http
Content-Type: application/dns-message
```

### CORS

The proxy adds:

```http
Access-Control-Allow-Origin: *
```

to DoH responses.

This allows browser-based clients and other web applications to use the proxy where appropriate.

## Web Query Interface

The Worker also provides a simple DNS query interface:

```text
/<SECRET_PATH_NAME>/query
```

For example:

```text
https://example.com/doh-path/query
```

The interface allows you to select:

* DoH provider
* Domain name
* Record type

Supported record types:

* `A`
* `AAAA`
* `CNAME`
* `ALL`

`ALL` performs the three queries concurrently:

```text
A
AAAA
CNAME
```

The interface displays:

* DNS response code
* Query latency
* Record type
* Record value
* TTL

## DNS Response Parsing

The built-in query interface constructs DNS wire-format queries and parses the returned DNS messages directly.

Currently supported record types include:

```text
A
AAAA
CNAME
```

The parser also recognizes several additional DNS record type names when they appear in responses, including:

```text
NS
SOA
PTR
MX
TXT
SRV
DS
RRSIG
NSEC
DNSKEY
SVCB
HTTPS
```

Unknown record types are represented using their numeric type code.

## Example

A DNS query can be sent directly through the Worker:

```bash
curl \
  -H "accept: application/dns-message" \
  "https://example.com/doh-path/cf?dns=..."
```

Or using POST:

```bash
curl \
  -X POST \
  -H "Content-Type: application/dns-message" \
  -H "Accept: application/dns-message" \
  --data-binary @query.bin \
  "https://example.com/doh-path/cf"
```

## Deployment

### 1. Create a Cloudflare Worker

Create a new Worker from the Cloudflare dashboard or using the Wrangler CLI.

### 2. Copy `worker.js`

Upload the contents of `worker.js` to your Worker.

No external dependencies are required.

### 3. Configure the secret path

Edit:

```javascript
const SECRET_PATH_NAME = "doh";
```

if you want to use a different URL prefix.

### 4. Deploy

Deploy the Worker using the Cloudflare dashboard or Wrangler.

After deployment, the following endpoints will be available:

```text
/<SECRET_PATH_NAME>/query
/<SECRET_PATH_NAME>/<provider>
```

## Security Considerations

This project is intentionally lightweight and does not implement user authentication.

If the Worker is exposed publicly, anyone who knows the URL may be able to use it as a DoH proxy.

Consider the following before deploying it publicly:

* Use a non-obvious `SECRET_PATH_NAME`
* Restrict access with Cloudflare Access if necessary
* Consider rate limiting for public deployments
* Monitor Worker usage and bandwidth
* Avoid exposing sensitive upstream configuration

The path name should not be considered a substitute for authentication.

## Privacy

This Worker forwards DNS queries to the selected upstream DNS provider.

The privacy characteristics of DNS queries therefore depend partly on the selected provider and its policies.

The Worker itself does not require a database or persistent storage for DNS queries.

However, Cloudflare Worker request processing, logging, analytics, and the upstream DNS provider may have their own data-handling policies.

Choose an upstream provider according to your own privacy and filtering requirements.

## Limitations

This project is a **DoH proxy**, not a full recursive DNS resolver.

It does not:

* Perform recursive DNS resolution
* Maintain a local DNS cache
* Provide DNSSEC validation itself
* Implement its own blocklists
* Implement its own malware database
* Provide authentication by default
* Guarantee anonymity

Filtering behavior is provided by the selected upstream DNS provider.

For example, Google Public DNS does not provide dedicated ad-blocking or family-filtering endpoints comparable to AdGuard DNS or Cloudflare's filtering endpoints.

## Project Structure

The project is intentionally kept as a single Worker script:

```text
.
└── worker.js
```

The main components are:

```text
Configuration
├── SECRET_PATH_NAME
└── routes

Worker Router
├── Web Query Interface
├── DoH Proxy
└── Default Response

DNS Client
├── DNS Query Generator
├── DNS Response Parser
├── DNS Name Parser
└── IPv6 Parser

Web Interface
├── Provider Selection
├── Domain Input
├── Record Type Selection
└── Result Renderer
```

## License

MIT License

## Disclaimer

This project is provided as-is.

The availability, filtering behavior, privacy characteristics, and operational policies of third-party DNS providers are outside the control of this project.

Always check the documentation and policies of the upstream DNS provider you choose.
