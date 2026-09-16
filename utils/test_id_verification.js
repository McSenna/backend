"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const {
  SUPPORTED_ID_TYPES,
  REJECTION_REASONS,
  ID_DOCUMENT_LIMITS,
  maskIdNumber,
} = require("../config/idVerification");
const {
  VERIFICATION_STORAGE_DIR,
  saveGovernmentIdDocument,
  resolveIdDocumentPath,
  deleteIdDocumentFile,
} = require("../services/storageService");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name} — ${error.message}`);
    console.log(`  FAIL  ${name} — ${error.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(`${name} — ${error.message}`);
    console.log(`  FAIL  ${name} — ${error.message}`);
  }
}

async function rejectsWith(promise, fragment) {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      String(error.message).includes(fragment),
      `expected message to include "${fragment}", got "${error.message}"`
    );
    return error;
  }
  throw new Error(`expected a rejection mentioning "${fragment}", but it resolved`);
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x20),
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64, 0x20)]);

const asDataUri = (buffer, mime) => `data:${mime};base64,${buffer.toString("base64")}`;

async function run() {
  console.log("\n=== Government ID configuration ===");

  check("every ID type has a stable id and a human label", () => {
    assert.ok(SUPPORTED_ID_TYPES.length >= 12, "expected the full ID catalogue");
    for (const type of SUPPORTED_ID_TYPES) {
      assert.ok(type.id && typeof type.id === "string", "missing id");
      assert.ok(type.label && typeof type.label === "string", `missing label for ${type.id}`);
      assert.strictEqual(type.id, type.id.toLowerCase(), `id ${type.id} must be lowercase`);
    }
  });

  check("ID type ids are unique", () => {
    const ids = SUPPORTED_ID_TYPES.map((type) => type.id);
    assert.strictEqual(new Set(ids).size, ids.length, "duplicate ID type id");
  });

  check("the documented ID types are all present", () => {
    const ids = SUPPORTED_ID_TYPES.map((type) => type.id);
    for (const expected of [
      "philsys",
      "drivers_license",
      "tin_id",
      "passport",
      "umid",
      "postal_id",
      "voters_id",
      "senior_citizen_id",
      "pwd_id",
      "school_id",
      "employee_id",
      "other_gov_id",
    ]) {
      assert.ok(ids.includes(expected), `missing ID type ${expected}`);
    }
  });

  check("rejection reasons include Other, which requires remarks", () => {
    assert.ok(REJECTION_REASONS.includes("Other"));
    assert.ok(REJECTION_REASONS.includes("Information does not match the ID"));
    assert.ok(REJECTION_REASONS.includes("Invalid ID"));
    assert.ok(REJECTION_REASONS.includes("ID image is unreadable"));
    assert.ok(REJECTION_REASONS.includes("Incomplete registration information"));
    assert.ok(REJECTION_REASONS.includes("Duplicate account"));
    assert.ok(REJECTION_REASONS.includes("Resident verification failed"));
  });

  check("the limit is 10MB and only JPG, PNG and PDF are allowed", () => {
    assert.strictEqual(ID_DOCUMENT_LIMITS.maxBytes, 10 * 1024 * 1024);
    assert.deepStrictEqual(
      [...ID_DOCUMENT_LIMITS.allowedMimes].sort(),
      ["application/pdf", "image/jpeg", "image/jpg", "image/png"]
    );
  });

  console.log("\n=== ID number masking ===");

  check("masking leaves only the last four digits", () => {
    assert.strictEqual(maskIdNumber("1234-5678-9012-3456"), "**** **** **** 3456");
  });

  check("a short number is not padded into a false length", () => {
    assert.strictEqual(maskIdNumber("123"), "123");
    assert.strictEqual(maskIdNumber("6789"), "6789");
  });

  check("a missing number masks to a placeholder rather than throwing", () => {
    assert.strictEqual(maskIdNumber(""), "****");
    assert.strictEqual(maskIdNumber(null), "****");
    assert.strictEqual(maskIdNumber(undefined), "****");
  });

  check("no masked value leaks more than the last four characters", () => {
    const secret = "PHL987654321000";
    const masked = maskIdNumber(secret);
    assert.ok(!masked.includes(secret.slice(0, -4)), "masked value leaked the ID body");
    assert.ok(masked.endsWith("1000"));
  });

  console.log("\n=== Document validation ===");

  const written = [];

  await checkAsync("a JPEG data URI is accepted and stored under a UUID name", async () => {
    const saved = await saveGovernmentIdDocument(asDataUri(JPEG, "image/jpeg"), "my id.jpg");
    written.push(saved.filePath);
    assert.strictEqual(saved.mimeType, "image/jpeg");
    assert.strictEqual(saved.fileSize, JPEG.length);
    assert.ok(
      /^[0-9a-f-]{36}\.jpg$/.test(saved.filePath),
      `expected a UUID filename, got ${saved.filePath}`
    );
    assert.ok(!saved.fileName.includes("/"), "original name kept a path separator");
  });

  await checkAsync("a PNG is accepted", async () => {
    const saved = await saveGovernmentIdDocument(asDataUri(PNG, "image/png"), "id.png");
    written.push(saved.filePath);
    assert.strictEqual(saved.mimeType, "image/png");
    assert.ok(saved.filePath.endsWith(".png"));
  });

  await checkAsync("a PDF is accepted", async () => {
    const saved = await saveGovernmentIdDocument(asDataUri(PDF, "application/pdf"), "id.pdf");
    written.push(saved.filePath);
    assert.strictEqual(saved.mimeType, "application/pdf");
    assert.ok(saved.filePath.endsWith(".pdf"));
  });

  await checkAsync("raw base64 without a data URI prefix is accepted", async () => {
    const saved = await saveGovernmentIdDocument(JPEG.toString("base64"), "id.jpg");
    written.push(saved.filePath);
    assert.strictEqual(saved.mimeType, "image/jpeg");
  });

  await checkAsync("an unsupported format is refused even in a JPEG wrapper", async () => {
    await rejectsWith(
      saveGovernmentIdDocument(asDataUri(GIF, "image/jpeg"), "sneaky.jpg"),
      "Unsupported or corrupted file format"
    );
  });

  await checkAsync("an executable renamed to .png is refused", async () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 0x00)]);
    await rejectsWith(
      saveGovernmentIdDocument(asDataUri(elf, "image/png"), "payload.png"),
      "Unsupported or corrupted file format"
    );
  });

  await checkAsync("a document over 10MB is refused", async () => {
    const oversized = Buffer.concat([JPEG, Buffer.alloc(ID_DOCUMENT_LIMITS.maxBytes, 0x20)]);
    await rejectsWith(
      saveGovernmentIdDocument(asDataUri(oversized, "image/jpeg"), "huge.jpg"),
      "exceeds the maximum size limit"
    );
  });

  await checkAsync("an empty document is refused", async () => {
    await rejectsWith(saveGovernmentIdDocument("", "empty.jpg"), "required");
    await rejectsWith(
      saveGovernmentIdDocument("data:image/jpeg;base64,", "empty.jpg"),
      "empty"
    );
  });

  await checkAsync("a file path or URL is refused instead of being fetched", async () => {
    for (const input of [
      "file:///etc/passwd",
      "content://media/external/images/1",
      "http://example.com/id.jpg",
      "https://example.com/id.jpg",
    ]) {
      await rejectsWith(
        saveGovernmentIdDocument(input, "id.jpg"),
        "Direct file paths or URLs are not accepted"
      );
    }
  });

  console.log("\n=== Stored path safety ===");

  await checkAsync("a stored document resolves inside the private directory", async () => {
    const saved = await saveGovernmentIdDocument(asDataUri(PNG, "image/png"), "id.png");
    written.push(saved.filePath);

    const resolved = resolveIdDocumentPath(saved.filePath);
    assert.ok(resolved, "expected the stored document to resolve");
    assert.ok(
      resolved.startsWith(VERIFICATION_STORAGE_DIR + path.sep),
      "resolved outside the storage directory"
    );
    assert.ok(fs.existsSync(resolved), "resolved path does not exist on disk");
  });

  check("path traversal cannot escape the storage directory", () => {
    for (const attempt of [
      "../../../../etc/passwd",
      "../../.env",
      "..%2F..%2F.env",
      "/etc/passwd",
      "subdir/../../../secret",
    ]) {
      const resolved = resolveIdDocumentPath(attempt);
      if (resolved !== null) {
        assert.ok(
          resolved.startsWith(VERIFICATION_STORAGE_DIR + path.sep),
          `traversal escaped with "${attempt}" → ${resolved}`
        );
      }
    }
  });

  check("a missing or malformed name resolves to nothing", () => {
    assert.strictEqual(resolveIdDocumentPath(""), null);
    assert.strictEqual(resolveIdDocumentPath(null), null);
    assert.strictEqual(resolveIdDocumentPath(undefined), null);
    assert.strictEqual(resolveIdDocumentPath("does-not-exist.jpg"), null);
  });

  await checkAsync("the private directory is not world-readable", async () => {
    const stats = await fs.promises.stat(VERIFICATION_STORAGE_DIR);
    const mode = stats.mode & 0o777;
    assert.strictEqual(
      mode & 0o007,
      0,
      `storage directory is reachable by others (mode ${mode.toString(8)})`
    );
  });

  await checkAsync("deleting a document removes it from disk", async () => {
    const saved = await saveGovernmentIdDocument(asDataUri(JPEG, "image/jpeg"), "temp.jpg");
    const resolved = resolveIdDocumentPath(saved.filePath);
    assert.ok(resolved && fs.existsSync(resolved));

    await deleteIdDocumentFile(saved.filePath);
    assert.strictEqual(resolveIdDocumentPath(saved.filePath), null);
  });

  await checkAsync("deleting an absent document is a no-op, not a throw", async () => {
    await deleteIdDocumentFile("never-existed.jpg");
    await deleteIdDocumentFile("../../../etc/passwd");
  });

  for (const name of written) {
    await deleteIdDocumentFile(name);
  }

  console.log("\n==================================================");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((line) => console.log(`  - ${line}`));
  }
  console.log("==================================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Test suite crashed:", error);
  process.exit(1);
});
