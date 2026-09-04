// Firebase Admin SDK — server only (API routes, middleware, server components)
import * as admin from 'firebase-admin'

if (!admin.apps.length) {
  if (
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    // Production: explicit service account credentials
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  } else {
    // Local dev: Application Default Credentials (gcloud auth application-default login)
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    })
  }
}

export const adminAuth = admin.auth()

/**
 * Returns a working Admin Auth instance. Prefers env-based service-account creds
 * (the default app); otherwise uses an in-app service account saved in Settings
 * (firebase_admin_config), initialized as a separate named app. Throws if
 * neither is configured — callers can catch and fall back (e.g. reset email).
 */
export async function getAdminAuth(): Promise<admin.auth.Auth> {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) return admin.auth()

  const existing = admin.apps.find((a) => a?.name === 'db-admin')
  if (existing) return existing.auth()

  const { prisma } = await import('@/lib/prisma')
  const { decrypt } = await import('@/lib/crypto')
  const cfg = await prisma.firebaseAdminConfig.findUnique({ where: { id: 'singleton' } })
  if (!cfg?.serviceAccountEnc) throw new Error('Firebase Admin is not configured — add a service account in Settings')

  const sa = JSON.parse(decrypt(cfg.serviceAccountEnc)) as { project_id?: string; client_email?: string; private_key?: string }
  if (!sa.client_email || !sa.private_key) throw new Error('Invalid service account JSON')
  const app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key.replace(/\\n/g, '\n'),
    }),
  }, 'db-admin')
  return app.auth()
}

/** True when either env creds or an in-app service account is configured. */
export async function adminConfigured(): Promise<boolean> {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) return true
  const { prisma } = await import('@/lib/prisma')
  const cfg = await prisma.firebaseAdminConfig.findUnique({ where: { id: 'singleton' }, select: { serviceAccountEnc: true } }).catch(() => null)
  return !!cfg?.serviceAccountEnc
}
