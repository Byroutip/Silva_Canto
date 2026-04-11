import { initializeApp } from "firebase/app";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    type User,
} from "firebase/auth";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    arrayUnion,
    arrayRemove,
} from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAuWLRG8m5rJx9u-c0ewJCr8DhPspkSCrI",
    authDomain: "canto-silva.firebaseapp.com",
    projectId: "canto-silva",
    storageBucket: "canto-silva.firebasestorage.app",
    messagingSenderId: "636304738552",
    appId: "1:636304738552:web:7d0932ebf8b5761bbf530d",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ── Auth ──

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("https://www.googleapis.com/auth/drive");
googleProvider.setCustomParameters({ prompt: "select_account" });

const DRIVE_TOKEN_KEY = "drive_access_token";

export function saveDriveToken(token: string): void {
    sessionStorage.setItem(DRIVE_TOKEN_KEY, token);
}

export function getSavedDriveToken(): string | null {
    return sessionStorage.getItem(DRIVE_TOKEN_KEY);
}

export async function loginWithGoogle(): Promise<{
    user: User;
    accessToken: string;
}> {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
        throw new Error("Nepodařilo se získat Google access token.");
    }
    saveDriveToken(credential.accessToken);
    return { user: result.user, accessToken: credential.accessToken };
}

// Try to restore session silently after page reload (e.g. after OAuth redirect)
export function waitForAuthRestore(): Promise<{ user: User; accessToken: string } | null> {
    return new Promise((resolve) => {
        const unsub = auth.onAuthStateChanged((user) => {
            unsub();
            if (!user) { resolve(null); return; }
            const token = getSavedDriveToken();
            if (token) {
                resolve({ user, accessToken: token });
            } else {
                resolve(null);
            }
        });
    });
}

export async function logoutFirebase(): Promise<void> {
    await signOut(auth);
}

// ── Access control (Firestore) ──

const ACCESS_DOC = doc(db, "settings", "access");

export type AccessConfig = {
    allowedEmails: string[];
    admins: string[];
};

export async function getAccessConfig(): Promise<AccessConfig> {
    const snap = await getDoc(ACCESS_DOC);
    if (!snap.exists()) {
        return { allowedEmails: [], admins: [] };
    }
    const data = snap.data();
    return {
        allowedEmails: (data.allowedEmails ?? []).map((e: string) => e.toLowerCase()),
        admins: (data.admins ?? []).map((e: string) => e.toLowerCase()),
    };
}

// Initial admin emails — seeded on first login when no config exists
const SEED_ADMINS = ["p.byrouti@gmail.com", "patrik.byrouti@digitec.cz"];

export async function initAccessConfig(adminEmail: string): Promise<void> {
    const snap = await getDoc(ACCESS_DOC);
    if (!snap.exists()) {
        const admins = [...new Set([adminEmail.toLowerCase(), ...SEED_ADMINS])];
        await setDoc(ACCESS_DOC, {
            allowedEmails: [...admins],
            admins: [...admins],
        });
    }
}

export function isEmailAllowed(config: AccessConfig, email: string): boolean {
    const normalized = email.toLowerCase();
    // If no allowed list, deny all (must explicitly add emails)
    if (config.allowedEmails.length === 0 && config.admins.length === 0) {
        return false;
    }
    return (
        config.allowedEmails.includes(normalized) ||
        config.admins.includes(normalized)
    );
}

export function isAdmin(config: AccessConfig, email: string): boolean {
    return config.admins.includes(email.toLowerCase());
}

export async function addAllowedEmail(email: string): Promise<void> {
    await updateDoc(ACCESS_DOC, {
        allowedEmails: arrayUnion(email.toLowerCase()),
    });
}

export async function removeAllowedEmail(email: string): Promise<void> {
    await updateDoc(ACCESS_DOC, {
        allowedEmails: arrayRemove(email.toLowerCase()),
    });
}

export async function addAdmin(email: string): Promise<void> {
    await updateDoc(ACCESS_DOC, {
        admins: arrayUnion(email.toLowerCase()),
    });
}

export async function removeAdmin(email: string): Promise<void> {
    await updateDoc(ACCESS_DOC, {
        admins: arrayRemove(email.toLowerCase()),
    });
}
