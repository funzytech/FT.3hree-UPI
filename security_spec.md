# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default-Deny Safety Net**: Any unmatched document path is denied for both read and write.
2. **Supporter Entry Schema Integrity (`/donation_supporters/{supporterId}`)**:
   - Only documents with `publicConsent == true` may be read or listed.
   - Public `create` strictly requires exact allowed keys (`donorName`, `donorAvatar`, `amount`, `upiId`, `verificationStatus`, `publicConsent`, `createdAt`), bounded string/number sizes (`donorName` 1..60 chars, `donorAvatar` 20..60000 chars matching `^data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$`, `amount` 0..10000000, `upiId` 3..64 chars), `verificationStatus == 'pending_verification'`, `publicConsent == true`, and server timestamp `createdAt == request.time`.
   - Public clients CANNOT forge `verificationStatus: 'verified'`, inject shadow fields, overwrite existing supporter entries, or delete entries.
   - Only a verified admin (`funzytechx@gmail.com` with `email_verified == true` or `/admins/{uid}`) may update (`verificationStatus` transition only) or delete supporter entries.
3. **PII Isolation (`/users/{userId}`)**:
   - Strictly isolated to `isOwner(userId)` or `isAdmin()`. No blanket signed-in reads.
4. **Legacy Collections (`/referrals`, `/coupons`, `/referral_events`, `/visitors`, `/referral_redemptions`)**:
   - Locked down strictly to verified admin (`isAdmin()`) to eliminate legacy `allow read, write: if true` exposure while preserving collection coverage.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Self-Verification Spoof**: Create `/donation_supporters/s1` with `verificationStatus: "verified"`.
2. **Shadow / Ghost Field Injection**: Create `/donation_supporters/s2` adding `isAdmin: true` or `featured: true`.
3. **Missing Consent Creation**: Create `/donation_supporters/s3` with `publicConsent: false`.
4. **Client Timestamp Tampering**: Create `/donation_supporters/s4` with a backdated client timestamp (`createdAt != request.time`).
5. **Oversized Avatar DoW Attack**: Create `/donation_supporters/s5` with `donorAvatar` > 60,000 bytes.
6. **Non-Image XSS Payload in Avatar**: Create `/donation_supporters/s6` with `donorAvatar: "javascript:alert(1)"` or `"data:text/html;base64,..."`.
7. **Negative / Infinite Amount**: Create `/donation_supporters/s7` with `amount: -500` or `amount: 999999999`.
8. **ID Poisoning**: Create `/donation_supporters/bad$id!with*invalid..chars` (fails `isValidId`).
9. **Unauthorized Update by Anonymous / Non-Admin**: Update `/donation_supporters/s1` setting `donorName` or `verificationStatus: "verified"`.
10. **Unauthorized Delete by Non-Admin**: Delete `/donation_supporters/s1` as unauthenticated user.
11. **Unverified Admin Email Spoof**: Request admin update with `email: "funzytechx@gmail.com"` and `email_verified: false`.
12. **Cross-User PII Read**: Signed-in user A attempting `get` on `/users/userB`.
