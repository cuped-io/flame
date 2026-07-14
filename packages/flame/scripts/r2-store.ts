import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { CdnObjectStore } from './cdn-publish';

/**
 * `CdnObjectStore` adapter over Cloudflare R2's S3 API. The write-once
 * guarantee rides on the S3-native conditional PUT (`If-None-Match: *`),
 * which R2 enforces at the storage layer — see ember ADR-0021.
 *
 * Credentials are a bucket-scoped R2 API token (write + list on the CDN
 * bucket only), minted per infra's RUNBOOK_CDN_CUTOVER.md.
 */

export interface R2StoreConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function createR2Store({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucket,
}: R2StoreConfig): CdnObjectStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // aws-sdk >= 3.729 defaults both to WHEN_SUPPORTED, which injects
    // x-amz-checksum-* headers R2's S3 API rejects. Cloudflare's docs
    // require WHEN_REQUIRED for R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    async putIfAbsent(key, body, contentType) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            IfNoneMatch: '*',
          }),
        );
        return 'created';
      } catch (error) {
        if (isPreconditionFailed(error)) {
          return 'conflict';
        }
        throw error;
      }
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },

    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!response.Body) return null;
        return await response.Body.transformToByteArray();
      } catch (error) {
        if (isNoSuchKey(error)) {
          return null;
        }
        throw error;
      }
    },

    async list() {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
        );
        for (const object of response.Contents ?? []) {
          if (object.Key) keys.push(object.Key);
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    },
  };
}

function isPreconditionFailed(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'PreconditionFailed' || err?.$metadata?.httpStatusCode === 412;
}

function isNoSuchKey(error: unknown): boolean {
  const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;
}

/** Build an R2 store from the environment the release workflow provides. */
export function r2StoreFromEnv(env: NodeJS.ProcessEnv = process.env): CdnObjectStore {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing R2 environment variables: ${missing.join(', ')}`);
  }
  return createR2Store({
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET!,
  });
}
