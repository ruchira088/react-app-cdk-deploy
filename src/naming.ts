import { createHash } from "node:crypto"

/**
 * S3 caps a bucket name at 63 characters. The bucket is named after the full
 * domain, so this is the binding constraint — it is stricter than the 63-char
 * limit DNS applies to each label individually.
 */
export const MAX_BUCKET_NAME_LENGTH = 63

const HASH_LENGTH = 6

/** One character of content, a separator, and the hash. */
const MIN_MAX_LENGTH = HASH_LENGTH + 2

/**
 * Reduces an arbitrary git branch name to a label that is simultaneously valid
 * as a DNS label, an S3 bucket name component, and a CloudFormation stack id
 * component — lowercase alphanumerics separated by single hyphens.
 *
 * Over-long values are truncated and given a deterministic hash suffix, so the
 * same branch always resolves to the same infrastructure names across deploys.
 */
export const sanitizeLabel = (value: string, maxLength: number): string => {
  if (maxLength < MIN_MAX_LENGTH) {
    throw new Error(
      `Cannot derive a label in ${maxLength} characters; the base domain leaves too little room`
    )
  }

  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (sanitized.length === 0) {
    throw new Error(`Unable to derive a valid label from "${value}"`)
  }

  if (sanitized.length <= maxLength) {
    return sanitized
  }

  // Hash the original rather than the sanitized value: two branches that differ
  // only in punctuation should not collide once truncated.
  const hash = createHash("sha256").update(value).digest("hex").slice(0, HASH_LENGTH)
  const truncated = sanitized.slice(0, maxLength - HASH_LENGTH - 1).replace(/-+$/g, "")

  return `${truncated}-${hash}`
}
