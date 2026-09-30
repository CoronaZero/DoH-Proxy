// ==============================
// 基础配置
// ==============================

// Secret Path，可自由修改
const SECRET_PATH_NAME = "kawaii";

// DoH 上游
const routes = {
  "cf": "https://cloudflare-dns.com/dns-query", // Cloudflare 无过滤
  "cf-security": "https://security.cloudflare-dns.com/dns-query", // Cloudflare 安全过滤
  "cf-family": "https://family.cloudflare-dns.com/dns-query", // Cloudflare 家庭过滤
  "google": "https://dns.google/dns-query", // Google Public DNS
  "quad9": "https://dns.quad9.net/dns-query", // Quad9 安全 DNS
  "adg": "https://dns.adguard-dns.com/dns-query", // AdGuard 广告与跟踪器过滤
  "adg-unfiltered": "https://unfiltered.adguard-dns.com/dns-query", // AdGuard 无过滤
  "adg-family": "https://family.adguard-dns.com/dns-query", // AdGuard 家庭过滤
  "opendns": "https://doh.opendns.com/dns-query", // OpenDNS
  "controld": "https://freedns.controld.com/p0", // Control D 无过滤
  "controld-malware": "https://freedns.controld.com/p1", // Control D 恶意软件过滤
  "controld-ads": "https://freedns.controld.com/p2", // Control D 广告与跟踪器过滤
  "controld-social": "https://freedns.controld.com/p3", // Control D 社交网站过滤
  "controld-family": "https://freedns.controld.com/family", // Control D 家庭过滤
  "controld-uncensored": "https://freedns.controld.com/uncensored", // Control D Uncensored
};

// Provider 显示名称
// routes 本身仍然只负责保存 URL，不改变原来的结构。
const providerNames = {
  "cf": "Cloudflare",
  "cf-security": "Cloudflare Security",
  "cf-family": "Cloudflare Family",
  "google": "Google Public DNS",
  "quad9": "Quad9",
  "adg": "AdGuard",
  "adg-unfiltered": "AdGuard Unfiltered",
  "adg-family": "AdGuard Family",
  "opendns": "OpenDNS",
  "controld": "Control D",
  "controld-malware": "Control D Malware",
  "controld-ads": "Control D Ads & Trackers",
  "controld-social": "Control D Social",
  "controld-family": "Control D Family",
  "controld-uncensored": "Control D Uncensored",
};


// ==============================
// DNS Record 类型
// ==============================

const RECORD_TYPES = {
  A: 1,
  CNAME: 5,
  AAAA: 28,
};


// ==============================
// Worker 主入口
// ==============================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const parts = url.pathname
      .split("/")
      .filter(Boolean);

    // ==========================
    // DNS 查询页面
    // /<SECRET_PATH_NAME>/query
    // ==========================

    if (
      parts.length === 2 &&
      parts[0] === SECRET_PATH_NAME &&
      parts[1] === "query"
    ) {
      if (request.method === "GET") {
        return new Response(getQueryPage(), {
          headers: {
            "Content-Type": "text/html; charset=UTF-8",
          },
        });
      }

      if (request.method === "POST") {
        try {
          const body = await request.json();

          const provider = body.provider;
          const domain = body.domain;
          const queryType = body.query_type || "ALL";

          if (!provider || !routes[provider]) {
            return Response.json(
              {
                error: "Invalid DNS provider",
              },
              {
                status: 400,
              }
            );
          }

          if (!domain) {
            return Response.json(
              {
                error: "Domain is required",
              },
              {
                status: 400,
              }
            );
          }

          const normalizedDomain = domain
            .trim()
            .replace(/\.+$/, "");

          // ========================
          // ALL：同时查询 A / AAAA / CNAME
          // ========================

          if (queryType === "ALL") {
            const [a, aaaa, cname] = await Promise.all([
              queryDoH(
                routes[provider],
                normalizedDomain,
                "A"
              ),

              queryDoH(
                routes[provider],
                normalizedDomain,
                "AAAA"
              ),

              queryDoH(
                routes[provider],
                normalizedDomain,
                "CNAME"
              ),
            ]);

            return Response.json({
              provider,
              domain: normalizedDomain,
              query_type: "ALL",
              elapsed_ms: Math.max(
                a.elapsed_ms,
                aaaa.elapsed_ms,
                cname.elapsed_ms
              ),
              results: {
                A: a,
                AAAA: aaaa,
                CNAME: cname,
              },
            });
          }

          // ========================
          // 单独查询
          // ========================

          if (!RECORD_TYPES[queryType]) {
            return Response.json(
              {
                error: "Invalid query type",
              },
              {
                status: 400,
              }
            );
          }

          const result = await queryDoH(
            routes[provider],
            normalizedDomain,
            queryType
          );

          return Response.json({
            provider,
            domain: normalizedDomain,
            query_type: queryType,
            elapsed_ms: result.elapsed_ms,
            results: {
              [queryType]: result,
            },
          });

        } catch (error) {
          return Response.json(
            {
              error: error instanceof Error
                ? error.message
                : String(error),
            },
            {
              status: 500,
            }
          );
        }
      }

      return new Response("Method Not Allowed", {
        status: 405,
      });
    }


    // ==========================
    // DoH 代理
    //
    // /<SECRET_PATH_NAME>/<provider>
    // ==========================

    if (
      parts.length === 2 &&
      parts[0] === SECRET_PATH_NAME &&
      routes[parts[1]]
    ) {
      const provider = parts[1];
      const upstream = routes[provider];

      // --------------------------
      // GET
      // --------------------------

      if (request.method === "GET") {
        const target = new URL(upstream);

        for (const [key, value] of url.searchParams) {
          target.searchParams.set(key, value);
        }

        const headers = new Headers(request.headers);

        headers.set(
          "Accept",
          "application/dns-message"
        );

        const response = await fetch(target.toString(), {
          method: "GET",
          headers,
        });

        const responseHeaders = new Headers(
          response.headers
        );

        responseHeaders.set(
          "Access-Control-Allow-Origin",
          "*"
        );

        return new Response(
          response.body,
          {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          }
        );
      }


      // --------------------------
      // POST
      // --------------------------

      if (request.method === "POST") {
        const headers = new Headers(request.headers);

        headers.set(
          "Content-Type",
          "application/dns-message"
        );

        headers.set(
          "Accept",
          "application/dns-message"
        );

        const response = await fetch(upstream, {
          method: "POST",
          headers,
          body: request.body,
        });

        const responseHeaders = new Headers(
          response.headers
        );

        responseHeaders.set(
          "Access-Control-Allow-Origin",
          "*"
        );

        return new Response(
          response.body,
          {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          }
        );
      }


      // --------------------------
      // OPTIONS
      // --------------------------

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods":
              "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type",
          },
        });
      }

      return new Response("Method Not Allowed", {
        status: 405,
      });
    }


    // ==========================
    // 默认响应
    // ==========================

    const cf = request.cf || {};

    const responseText = [
      `colo=${cf.colo || ""}`,
      `sliver=${cf.sliver || ""}`,
      `http=${cf.httpProtocol || ""}`,
      `loc=${cf.country || ""}`,
      `tls=${cf.tlsVersion || ""}`,
      `warp=${cf.warp || ""}`,
      `uag=${request.headers.get("User-Agent") || ""}`,
      "",
    ].join("\n");

    return new Response(responseText, {
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
      },
    });
  },
};


// ============================================================
// DNS 查询
// ============================================================

async function queryDoH(
  upstream,
  domain,
  recordType
) {
  const query = createDNSQuery(
    domain,
    recordType
  );

  const start = performance.now();

  const response = await fetch(
    upstream,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/dns-message",

        "Accept":
          "application/dns-message",
      },
      body: query,
    }
  );

  const elapsed = performance.now() - start;

  if (!response.ok) {
    throw new Error(
      `DoH request failed: ${response.status} ${response.statusText}`
    );
  }

  const buffer =
    new Uint8Array(
      await response.arrayBuffer()
    );

  const result =
    parseDNSResponse(buffer);

  result.elapsed_ms =
    Math.round(elapsed * 100) / 100;

  return result;
}


// ============================================================
// 创建 DNS Query
// ============================================================

function createDNSQuery(
  domain,
  recordType
) {
  const labels =
    domain.split(".");

  const nameBytes = [];

  for (const label of labels) {
    const bytes =
      new TextEncoder().encode(label);

    if (bytes.length > 63) {
      throw new Error(
        "DNS label is too long"
      );
    }

    nameBytes.push(bytes.length);

    for (const byte of bytes) {
      nameBytes.push(byte);
    }
  }

  nameBytes.push(0);

  const type =
    RECORD_TYPES[recordType];

  if (!type) {
    throw new Error(
      `Unsupported record type: ${recordType}`
    );
  }

  // Header
  //
  // ID       = 0x0000
  // Flags    = 0x0100 (RD)
  // QDCOUNT  = 1
  // ANCOUNT  = 0
  // NSCOUNT  = 0
  // ARCOUNT  = 0

  const buffer =
    new Uint8Array(
      12 +
      nameBytes.length +
      4
    );

  const view =
    new DataView(
      buffer.buffer
    );

  view.setUint16(
    0,
    0x0000
  );

  view.setUint16(
    2,
    0x0100
  );

  view.setUint16(
    4,
    1
  );

  view.setUint16(
    6,
    0
  );

  view.setUint16(
    8,
    0
  );

  view.setUint16(
    10,
    0
  );

  let offset = 12;

  buffer.set(
    nameBytes,
    offset
  );

  offset += nameBytes.length;

  view.setUint16(
    offset,
    type
  );

  offset += 2;

  // IN
  view.setUint16(
    offset,
    1
  );

  return buffer;
}


// ============================================================
// DNS Response Parser
// ============================================================

function parseDNSResponse(
  buffer
) {
  if (buffer.length < 12) {
    throw new Error(
      "Invalid DNS response"
    );
  }

  const view =
    new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );

  const flags =
    view.getUint16(2);

  const rcode =
    flags & 0x000f;

  const questionCount =
    view.getUint16(4);

  const answerCount =
    view.getUint16(6);

  const authorityCount =
    view.getUint16(8);

  const additionalCount =
    view.getUint16(10);

  let offset = 12;

  // 跳过 Question
  for (
    let i = 0;
    i < questionCount;
    i++
  ) {
    const result =
      skipDNSName(
        buffer,
        offset
      );

    offset =
      result.offset;

    if (offset + 4 > buffer.length) {
      throw new Error(
        "Invalid DNS question"
      );
    }

    offset += 4;
  }

  const answers = [];

  // Answer
  for (
    let i = 0;
    i < answerCount;
    i++
  ) {
    const result =
      parseDNSAnswer(
        buffer,
        view,
        offset
      );

    offset =
      result.offset;

    if (result.answer) {
      answers.push(
        result.answer
      );
    }
  }

  // Authority
  const authority = [];

  for (
    let i = 0;
    i < authorityCount;
    i++
  ) {
    const result =
      parseDNSAnswer(
        buffer,
        view,
        offset
      );

    offset =
      result.offset;

    if (result.answer) {
      authority.push(
        result.answer
      );
    }
  }

  // Additional
  const additional = [];

  for (
    let i = 0;
    i < additionalCount;
    i++
  ) {
    const result =
      parseDNSAnswer(
        buffer,
        view,
        offset
      );

    offset =
      result.offset;

    if (result.answer) {
      additional.push(
        result.answer
      );
    }
  }

  return {
    rcode,
    rcode_text:
      dnsRcodeText(rcode),

    question_count:
      questionCount,

    answer_count:
      answerCount,

    authority_count:
      authorityCount,

    additional_count:
      additionalCount,

    answers,
    authority,
    additional,
  };
}


// ============================================================
// 解析 DNS Answer
// ============================================================

function parseDNSAnswer(
  buffer,
  view,
  offset
) {
  const nameResult =
    parseDNSName(
      buffer,
      offset
    );

  const name =
    nameResult.name;

  offset =
    nameResult.offset;

  if (offset + 10 > buffer.length) {
    throw new Error(
      "Invalid DNS answer"
    );
  }

  const type =
    view.getUint16(offset);

  const klass =
    view.getUint16(offset + 2);

  const ttl =
    view.getUint32(offset + 4);

  const rdlength =
    view.getUint16(offset + 8);

  offset += 10;

  if (
    offset + rdlength >
    buffer.length
  ) {
    throw new Error(
      "Invalid DNS RDATA"
    );
  }

  let data = null;

  // A
  if (
    type === 1 &&
    rdlength === 4
  ) {
    data = [
      buffer[offset],
      buffer[offset + 1],
      buffer[offset + 2],
      buffer[offset + 3],
    ].join(".");
  }

  // CNAME
  else if (type === 5) {
    data =
      parseDNSName(
        buffer,
        offset
      ).name;
  }

  // AAAA
  else if (
    type === 28 &&
    rdlength === 16
  ) {
    data =
      parseIPv6(
        buffer,
        offset
      );
  }

  // 其他类型
  else {
    data =
      Array.from(
        buffer.slice(
          offset,
          offset + rdlength
        )
      )
        .map(
          byte =>
            byte
              .toString(16)
              .padStart(2, "0")
        )
        .join("");
  }

  offset += rdlength;

  return {
    offset,

    answer: {
      name,
      type: dnsTypeText(type),
      type_code: type,
      class: klass,
      ttl,
      data,
    },
  };
}


// ============================================================
// 跳过 DNS Name
// ============================================================

function skipDNSName(
  buffer,
  offset
) {
  let current = offset;
  let steps = 0;

  while (true) {
    if (
      current >= buffer.length
    ) {
      throw new Error(
        "Invalid DNS name"
      );
    }

    if (++steps > 128) {
      throw new Error(
        "DNS name too long"
      );
    }

    const length =
      buffer[current];

    // Compression pointer
    if (
      (length & 0xc0) === 0xc0
    ) {
      if (
        current + 1 >=
        buffer.length
      ) {
        throw new Error(
          "Invalid DNS pointer"
        );
      }

      current += 2;

      return {
        offset: current,
      };
    }

    if (length === 0) {
      current++;

      return {
        offset: current,
      };
    }

    if (
      length > 63 ||
      current + 1 + length >
        buffer.length
    ) {
      throw new Error(
        "Invalid DNS label"
      );
    }

    current +=
      1 + length;
  }
}


// ============================================================
// 解析 DNS Name
// ============================================================

function parseDNSName(
  buffer,
  offset
) {
  let current = offset;
  let jumped = false;
  let nextOffset = offset;

  const labels = [];

  let steps = 0;

  while (true) {
    if (
      current >= buffer.length
    ) {
      throw new Error(
        "Invalid DNS name"
      );
    }

    if (++steps > 128) {
      throw new Error(
        "DNS name compression loop"
      );
    }

    const length =
      buffer[current];

    // Compression pointer
    if (
      (length & 0xc0) === 0xc0
    ) {
      if (
        current + 1 >=
        buffer.length
      ) {
        throw new Error(
          "Invalid DNS pointer"
        );
      }

      const pointer =
        ((length & 0x3f) << 8) |
        buffer[current + 1];

      if (!jumped) {
        nextOffset =
          current + 2;
      }

      current = pointer;
      jumped = true;

      continue;
    }

    // End
    if (length === 0) {
      if (!jumped) {
        nextOffset =
          current + 1;
      }

      break;
    }

    if (
      length > 63 ||
      current + 1 + length >
        buffer.length
    ) {
      throw new Error(
        "Invalid DNS label"
      );
    }

    const labelBytes =
      buffer.slice(
        current + 1,
        current + 1 + length
      );

    labels.push(
      new TextDecoder().decode(
        labelBytes
      )
    );

    current +=
      1 + length;
  }

  return {
    name:
      labels.join("."),
    offset:
      nextOffset,
  };
}


// ============================================================
// IPv6 格式化
// ============================================================

function parseIPv6(
  buffer,
  offset
) {
  const groups = [];

  for (
    let i = 0;
    i < 8;
    i++
  ) {
    const value =
      (buffer[offset + i * 2] << 8) |
      buffer[offset + i * 2 + 1];

    groups.push(
      value.toString(16)
    );
  }

  // 寻找最长的连续 0
  let bestStart = -1;
  let bestLength = 0;

  let currentStart = -1;
  let currentLength = 0;

  for (
    let i = 0;
    i <= groups.length;
    i++
  ) {
    if (
      i < groups.length &&
      groups[i] === "0"
    ) {
      if (
        currentStart === -1
      ) {
        currentStart = i;
        currentLength = 1;
      } else {
        currentLength++;
      }
    } else {
      if (
        currentLength >
        bestLength
      ) {
        bestStart =
          currentStart;

        bestLength =
          currentLength;
      }

      currentStart = -1;
      currentLength = 0;
    }
  }

  // 只有至少两个连续 0 才进行 ::
  // 单个 0 不值得压缩
  if (bestLength >= 2) {
    const left =
      groups
        .slice(
          0,
          bestStart
        )
        .join(":");

    const right =
      groups
        .slice(
          bestStart +
            bestLength
        )
        .join(":");

    if (left && right) {
      return `${left}::${right}`;
    }

    if (left) {
      return `${left}::`;
    }

    if (right) {
      return `::${right}`;
    }

    return "::";
  }

  return groups.join(":");
}


// ============================================================
// DNS 类型名称
// ============================================================

function dnsTypeText(
  type
) {
  switch (type) {
    case 1:
      return "A";

    case 5:
      return "CNAME";

    case 28:
      return "AAAA";

    case 2:
      return "NS";

    case 6:
      return "SOA";

    case 12:
      return "PTR";

    case 15:
      return "MX";

    case 16:
      return "TXT";

    case 33:
      return "SRV";

    case 43:
      return "DS";

    case 46:
      return "RRSIG";

    case 47:
      return "NSEC";

    case 48:
      return "DNSKEY";

    case 65:
      return "HTTPS";

    case 64:
      return "SVCB";

    default:
      return `TYPE${type}`;
  }
}


// ============================================================
// DNS RCODE
// ============================================================

function dnsRcodeText(
  rcode
) {
  const names = {
    0: "NOERROR",
    1: "FORMERR",
    2: "SERVFAIL",
    3: "NXDOMAIN",
    4: "NOTIMP",
    5: "REFUSED",
    6: "YXDOMAIN",
    7: "YXRRSET",
    8: "NXRRSET",
    9: "NOTAUTH",
    10: "NOTZONE",
  };

  return (
    names[rcode] ||
    `RCODE_${rcode}`
  );
}


// ============================================================
// DNS 查询页面
// ============================================================

function getQueryPage() {
  // 根据 routes 自动生成 Provider 列表。
  // routes 新增项目后，这里会自动出现。
  const providerOptions =
    Object.keys(routes)
      .map((key) => {
        const name =
          providerNames[key] ||
          key;

        return `
          <option value="${escapeHtml(key)}">
            ${escapeHtml(name)}
          </option>
        `;
      })
      .join("");


  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>DNS Query</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 24px;

      background: #f5f5f5;
      color: #222;

      font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    h1 {
      margin-top: 0;
    }

    .card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;

      box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.08);
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
    }

    select,
    input,
    button {
      width: 100%;
      min-height: 42px;

      border: 1px solid #ccc;
      border-radius: 8px;

      padding: 8px 12px;

      font-size: 15px;
    }

    input,
    select {
      background: white;
    }

    button {
      margin-top: 18px;

      background: #222;
      color: white;

      cursor: pointer;
    }

    button:hover {
      opacity: 0.9;
    }

    .field {
      margin-bottom: 18px;
    }

    .radio-group {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }

    .radio-item {
      display: flex;
      align-items: center;
      gap: 6px;

      font-weight: normal;
    }

    .radio-item input {
      width: auto;
      min-height: auto;
    }

    .result {
      white-space: pre-wrap;
      word-break: break-word;

      font-family:
        ui-monospace,
        SFMono-Regular,
        Menlo,
        Consolas,
        monospace;

      font-size: 14px;
    }

    .status {
      margin-top: 12px;
      color: #666;
    }

    .record {
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }

    .record:last-child {
      border-bottom: 0;
    }

    .record-type {
      font-weight: bold;
    }

    .record-data {
      margin-top: 4px;
      word-break: break-all;
    }

    .error {
      color: #b00020;
    }

    .success {
      color: #16803c;
    }
  </style>
</head>

<body>

<div class="container">

  <h1>DNS Query</h1>

  <div class="card">

    <div class="field">

      <label for="provider">
        DoH Endpoint
      </label>

      <select id="provider">
        ${providerOptions}
      </select>

    </div>


    <div class="field">

      <label for="domain">
        Domain
      </label>

      <input
        id="domain"
        type="text"
        placeholder="example.com"
        autocomplete="off"
      >

    </div>


    <div class="field">

      <label>
        Query Type
      </label>

      <div class="radio-group">

        <label class="radio-item">
          <input
            type="radio"
            name="query_type"
            value="ALL"
            checked
          >
          全部（A + AAAA + CNAME）
        </label>

        <label class="radio-item">
          <input
            type="radio"
            name="query_type"
            value="A"
          >
          A
        </label>

        <label class="radio-item">
          <input
            type="radio"
            name="query_type"
            value="AAAA"
          >
          AAAA
        </label>

        <label class="radio-item">
          <input
            type="radio"
            name="query_type"
            value="CNAME"
          >
          CNAME
        </label>

      </div>

    </div>


    <button id="queryButton">
      Query
    </button>

    <div
      id="status"
      class="status"
    ></div>

  </div>


  <div
    id="resultCard"
    class="card"
    style="display: none;"
  >

    <h2>Result</h2>

    <div id="result"></div>

  </div>

</div>


<script>

const queryButton =
  document.getElementById(
    "queryButton"
  );

const provider =
  document.getElementById(
    "provider"
  );

const domain =
  document.getElementById(
    "domain"
  );

const status =
  document.getElementById(
    "status"
  );

const resultCard =
  document.getElementById(
    "resultCard"
  );

const result =
  document.getElementById(
    "result"
  );


queryButton.addEventListener(
  "click",
  async () => {

    const domainValue =
      domain.value.trim();

    if (!domainValue) {
      status.textContent =
        "请输入域名";

      status.className =
        "status error";

      return;
    }


    const queryType =
      document.querySelector(
        'input[name="query_type"]:checked'
      ).value;


    queryButton.disabled =
      true;

    status.textContent =
      "Querying...";

    status.className =
      "status";

    resultCard.style.display =
      "none";


    try {

      // 使用当前页面路径。
      // 因此 SECRET_PATH_NAME 修改后，
      // 前端不需要再修改。
      const response =
        await fetch(
          location.pathname,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              provider:
                provider.value,

              domain:
                domainValue,

              query_type:
                queryType,
            }),
          }
        );


      const data =
        await response.json();


      if (!response.ok) {
        throw new Error(
          data.error ||
          "Request failed"
        );
      }


      renderResult(data);


      status.textContent =
        "Query completed";

      status.className =
        "status success";

      resultCard.style.display =
        "block";

    } catch (error) {

      status.textContent =
        error instanceof Error
          ? error.message
          : String(error);

      status.className =
        "status error";

    } finally {

      queryButton.disabled =
        false;

    }
  }
);


function renderResult(data) {

  result.innerHTML = "";


  if (
    data.query_type ===
    "ALL"
  ) {

    renderRecordGroup(
      "A",
      data.results.A
    );

    renderRecordGroup(
      "AAAA",
      data.results.AAAA
    );

    renderRecordGroup(
      "CNAME",
      data.results.CNAME
    );

  } else {

    renderRecordGroup(
      data.query_type,
      data.results[
        data.query_type
      ]
    );

  }


  const meta =
    document.createElement(
      "div"
    );

  meta.style.marginBottom =
    "16px";

  meta.innerHTML =
    "<strong>Provider:</strong> " +
    escapeHtml(
      data.provider
    ) +
    "<br>" +

    "<strong>Domain:</strong> " +
    escapeHtml(
      data.domain
    ) +
    "<br>" +

    "<strong>Query Type:</strong> " +
    escapeHtml(
      data.query_type
    );

  result.prepend(meta);
}


function renderRecordGroup(
  type,
  data
) {

  if (!data) {
    return;
  }


  const title =
    document.createElement(
      "h3"
    );

  title.textContent =
    type;

  result.appendChild(
    title
  );


  const meta =
    document.createElement(
      "div"
    );

  meta.className =
    "status";

  meta.textContent =
    "RCODE: " +
    data.rcode_text +
    " | " +

    "Elapsed: " +
    data.elapsed_ms +
    " ms";

  result.appendChild(
    meta
  );


  if (
    !data.answers ||
    data.answers.length === 0
  ) {

    const empty =
      document.createElement(
        "div"
      );

    empty.className =
      "status";

    empty.textContent =
      "No answer";

    result.appendChild(
      empty
    );

    return;
  }


  for (
    const answer
    of data.answers
  ) {

    const record =
      document.createElement(
        "div"
      );

    record.className =
      "record";


    const recordType =
      document.createElement(
        "div"
      );

    recordType.className =
      "record-type";

    recordType.textContent =
      answer.type;


    const recordData =
      document.createElement(
        "div"
      );

    recordData.className =
      "record-data";

    recordData.textContent =
      answer.data;


    const ttl =
      document.createElement(
        "div"
      );

    ttl.className =
      "status";

    ttl.textContent =
      "TTL: " +
      answer.ttl;


    record.appendChild(
      recordType
    );

    record.appendChild(
      recordData
    );

    record.appendChild(
      ttl
    );


    result.appendChild(
      record
    );
  }
}


function escapeHtml(
  value
) {

  return String(value)
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}

</script>

</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
