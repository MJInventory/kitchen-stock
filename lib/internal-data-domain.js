import crypto from "node:crypto";

function normalizeServiceUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeCipherSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function encryptPassword(secret, plaintext) {
  const value = String(plaintext || "");
  const iv = crypto.randomBytes(12);
  const key = normalizeCipherSecret(secret);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptPassword(secret, payload) {
  const raw = String(payload || "").trim();
  if (!raw) return "";
  const [ivPart, tagPart, dataPart] = raw.split(".");
  if (!ivPart || !tagPart || !dataPart) return "";
  const key = normalizeCipherSecret(secret);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

export function createInternalDataDomain({
  assertPostgresSchemaReady,
  db,
  isValidId,
  authSecret
}) {
  function mapRow(row) {
    return {
      id: row.id,
      serviceName: row.service_name || "",
      serviceUrl: row.service_url || "",
      username: row.username || "",
      password: decryptPassword(authSecret, row.password_encrypted),
      twoFactorEnabled: row.two_factor_enabled !== false,
      twoFactorDetails: row.two_factor_details || "",
      memo: row.memo || "",
      createdBy: row.created_by_username || "",
      updatedBy: row.updated_by_username || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || ""
    };
  }

  async function listInternalDataServices() {
    assertPostgresSchemaReady();
    const result = await db().query(`
      select *
      from internal_data_services
      order by lower(service_name), created_at desc
    `);
    return result.rows.map(mapRow);
  }

  async function saveInternalDataService(payload, recordId = "", actorUsername = "") {
    assertPostgresSchemaReady();
    const serviceName = String(payload.serviceName || payload.name || "").trim();
    const serviceUrl = normalizeServiceUrl(payload.serviceUrl || payload.url || "");
    const username = String(payload.username || "").trim();
    const password = String(payload.password || "").trim();
    const twoFactorEnabled = Boolean(payload.twoFactorEnabled);
    const twoFactorDetails = String(payload.twoFactorDetails || "").trim();
    const memo = String(payload.memo || "").trim();
    if (!serviceName) throw new Error("Service name is required.");
    if (!serviceUrl) throw new Error("Website URL is required.");
    const encryptedPassword = encryptPassword(authSecret, password);

    if (recordId) {
      if (!isValidId(recordId)) throw new Error("Invalid internal data record.");
      const result = await db().query(`
        update internal_data_services
        set service_name = $2,
            service_url = $3,
            username = $4,
            password_encrypted = $5,
            two_factor_enabled = $6,
            two_factor_details = $7,
            memo = $8,
            updated_by_username = $9,
            updated_at = now()
        where id = $1
        returning *
      `, [recordId, serviceName, serviceUrl, username, encryptedPassword, twoFactorEnabled, twoFactorDetails, memo, actorUsername]);
      if (!result.rows[0]) throw new Error("Internal data record was not found.");
      return mapRow(result.rows[0]);
    }

    const created = await db().query(`
      insert into internal_data_services (
        service_name,
        service_url,
        username,
        password_encrypted,
        two_factor_enabled,
        two_factor_details,
        memo,
        created_by_username,
        updated_by_username
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$8)
      returning *
    `, [serviceName, serviceUrl, username, encryptedPassword, twoFactorEnabled, twoFactorDetails, memo, actorUsername]);
    return mapRow(created.rows[0]);
  }

  async function deleteInternalDataService(recordId) {
    assertPostgresSchemaReady();
    if (!isValidId(recordId)) throw new Error("Invalid internal data record.");
    const result = await db().query(`
      delete from internal_data_services
      where id = $1
      returning id
    `, [recordId]);
    if (!result.rows[0]) throw new Error("Internal data record was not found.");
    return { id: result.rows[0].id, deleted: true };
  }

  return {
    listInternalDataServices,
    saveInternalDataService,
    deleteInternalDataService
  };
}
