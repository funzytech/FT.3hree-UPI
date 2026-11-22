import React, { useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  db,
  DONATION_SUPPORTERS_COLLECTION,
  DONOR_AVATAR_MAX_LENGTH,
  DONOR_AVATAR_PATTERN,
  DONOR_NAME_MAX_LENGTH,
  handleFirestoreError,
  MAX_DONATION_AMOUNT,
  OperationType,
} from '../firebase';

interface DonationCelebrationProps {
  amount: number | null;
  upiId: string;
  onClose: () => void;
}

interface BurstParticle {
  id: number;
  angle: number;
  distance: number;
  size: number;
  delay: number;
  color: string;
  shape: 'star' | 'ribbon' | 'diamond';
  rotateEnd: number;
}

const BURST_PARTICLES: BurstParticle[] = [
  { id: 1, angle: -90, distance: 56, size: 10, delay: 0.12, color: '#f59e0b', shape: 'star', rotateEnd: 160 },
  { id: 2, angle: -56, distance: 60, size: 8, delay: 0.15, color: '#fbbf24', shape: 'diamond', rotateEnd: 45 },
  { id: 3, angle: -24, distance: 54, size: 8, delay: 0.18, color: '#10b981', shape: 'ribbon', rotateEnd: 135 },
  { id: 4, angle: 8, distance: 58, size: 7, delay: 0.14, color: '#d97706', shape: 'diamond', rotateEnd: 90 },
  { id: 5, angle: 38, distance: 54, size: 9, delay: 0.2, color: '#f59e0b', shape: 'star', rotateEnd: -120 },
  { id: 6, angle: 70, distance: 58, size: 8, delay: 0.16, color: '#10b981', shape: 'ribbon', rotateEnd: -120 },
  { id: 7, angle: 110, distance: 55, size: 9, delay: 0.19, color: '#fbbf24', shape: 'star', rotateEnd: -150 },
  { id: 8, angle: 144, distance: 60, size: 8, delay: 0.14, color: '#d97706', shape: 'ribbon', rotateEnd: 110 },
  { id: 9, angle: 176, distance: 56, size: 7, delay: 0.17, color: '#fbbf24', shape: 'diamond', rotateEnd: -90 },
  { id: 10, angle: -152, distance: 60, size: 9, delay: 0.15, color: '#10b981', shape: 'star', rotateEnd: 130 },
  { id: 11, angle: -120, distance: 56, size: 9, delay: 0.18, color: '#d97706', shape: 'star', rotateEnd: 140 },
  { id: 12, angle: -10, distance: 48, size: 6, delay: 0.22, color: '#fbbf24', shape: 'diamond', rotateEnd: 45 },
];

const renderParticleShape = (particle: BurstParticle) => {
  switch (particle.shape) {
    case 'star':
      return (
        <svg width={particle.size} height={particle.size} viewBox="0 0 24 24" fill={particle.color}>
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
        </svg>
      );
    case 'ribbon':
      return (
        <span
          className="block rounded-full"
          style={{
            width: `${particle.size}px`,
            height: `${Math.max(3, Math.round(particle.size * 0.42))}px`,
            backgroundColor: particle.color,
          }}
        />
      );
    case 'diamond':
      return (
        <span
          className="block rotate-45 rounded-[2px]"
          style={{
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            backgroundColor: particle.color,
          }}
        />
      );
  }
};

// Resize & center-crop uploaded photo to lightweight 120x120 JPEG guaranteed <= 60KB
function compressAvatarImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const size = 120;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

        let dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl.length > DONOR_AVATAR_MAX_LENGTH) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.52);
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const DonationCelebration: React.FC<DonationCelebrationProps> = ({
  amount,
  upiId,
  onClose,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [donorName, setDonorName] = useState<string>('');
  const [donorAvatar, setDonorAvatar] = useState<string>('');
  const [publicConsent, setPublicConsent] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitState, setSubmitState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please choose an image file.');
      return;
    }
    setErrorMessage('');
    try {
      const compressed = await compressAvatarImage(file);
      if (compressed.length > DONOR_AVATAR_MAX_LENGTH || !DONOR_AVATAR_PATTERN.test(compressed)) {
        setErrorMessage('Image is too large. Please pick another photo.');
        return;
      }
      setDonorAvatar(compressed);
    } catch {
      setErrorMessage('Could not load image. Try another photo.');
    }
  };

  const canSubmit =
    donorName.trim().length > 0 &&
    donorAvatar.length > 0 &&
    publicConsent &&
    !isSubmitting;

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canSubmit) return;

    const cleanName = donorName.trim().slice(0, DONOR_NAME_MAX_LENGTH);
    const safeAmount =
      typeof amount === 'number' && Number.isFinite(amount) && amount > 0
        ? Math.min(Math.round(amount), MAX_DONATION_AMOUNT)
        : 0;

    if (!DONOR_AVATAR_PATTERN.test(donorAvatar) || donorAvatar.length > DONOR_AVATAR_MAX_LENGTH) {
      setErrorMessage('Please upload a valid profile image.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      await addDoc(collection(db, DONATION_SUPPORTERS_COLLECTION), {
        donorName: cleanName,
        donorAvatar,
        amount: safeAmount,
        upiId,
        verificationStatus: 'pending_verification',
        publicConsent: true,
        createdAt: serverTimestamp(),
      });
      setSubmitState('saved');
    } catch (error) {
      setSubmitState('error');
      setErrorMessage('Could not save right now. Please try again.');
      try {
        handleFirestoreError(error, OperationType.CREATE, DONATION_SUPPORTERS_COLLECTION);
      } catch {
        // Logged via handleFirestoreError
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-center text-center gap-3">
      {/* Celebratory Animated Medallion Stage (heart/like animation removed) */}
      <div
        className="relative flex items-center justify-center w-26 h-26 -mt-1 -mb-1 select-none shrink-0"
        aria-hidden="true"
      >
        {/* Warm radial ambient glow */}
        <motion.div
          initial={prefersReducedMotion ? { opacity: 0.5, scale: 1 } : { opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 0.65, 0.42], scale: [0.4, 1.15, 1] }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.32)_0%,rgba(16,185,129,0.14)_48%,transparent_72%)] pointer-events-none"
        />

        {/* Staggered Expanding Ripple Halo Rings */}
        {!prefersReducedMotion &&
          [0, 1, 2].map((ringIdx) => (
            <motion.div
              key={ringIdx}
              initial={{ scale: 0.55, opacity: 0.7 }}
              animate={{ scale: 1.68 + ringIdx * 0.14, opacity: 0 }}
              transition={{
                duration: 1.05,
                delay: 0.1 + ringIdx * 0.16,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="absolute w-16 h-16 rounded-full border-2 pointer-events-none"
              style={{
                borderColor:
                  ringIdx === 0
                    ? 'rgba(217, 119, 6, 0.54)'
                    : ringIdx === 1
                    ? 'rgba(251, 191, 36, 0.4)'
                    : 'rgba(16, 185, 129, 0.34)',
              }}
            />
          ))}

        {/* Radial Polar-Trajectory Celebration Particles */}
        {!prefersReducedMotion &&
          BURST_PARTICLES.map((particle) => {
            const rad = (particle.angle * Math.PI) / 180;
            const targetX = Math.cos(rad) * particle.distance;
            const targetY = Math.sin(rad) * particle.distance;

            return (
              <motion.div
                key={particle.id}
                initial={{ x: 0, y: 0, scale: 0, opacity: 0, rotate: 0 }}
                animate={{
                  x: [0, targetX * 1.06, targetX],
                  y: [0, targetY * 1.06, targetY + 3],
                  scale: [0, 1.16, 0.9, 0],
                  opacity: [0, 1, 0.95, 0],
                  rotate: [0, particle.rotateEnd],
                }}
                transition={{
                  duration: 1.2,
                  delay: particle.delay,
                  times: [0, 0.32, 0.72, 1],
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="absolute pointer-events-none"
              >
                {renderParticleShape(particle)}
              </motion.div>
            );
          })}

        {/* Main Embossed Liquid-Glass Celebration Seal */}
        <motion.div
          initial={prefersReducedMotion ? { scale: 1, opacity: 1 } : { scale: 0, rotate: -18, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{
            type: 'spring',
            stiffness: 360,
            damping: 20,
            mass: 0.8,
          }}
          className="relative z-10 flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-[#3a2210] via-[#2c1708] to-[#1a0d04] shadow-[0_12px_26px_-6px_rgba(44,23,8,0.52),inset_0_2px_3px_rgba(255,255,255,0.28)] border border-[#d9a659]/55 overflow-hidden"
        >
          {/* Diagonal Glass Light Sheen Sweep */}
          {!prefersReducedMotion && (
            <motion.div
              initial={{ x: '-140%', skewX: -22 }}
              animate={{ x: '220%', skewX: -22 }}
              transition={{ duration: 0.9, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none"
            />
          )}

          {/* Self-Drawing Golden Perimeter Ring + Crisp Animated Checkmark */}
          <svg className="w-12 h-12" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="27" stroke="rgba(251, 191, 36, 0.2)" strokeWidth="2.6" />
            <motion.circle
              cx="32"
              cy="32"
              r="27"
              stroke="url(#ft3GoldRing)"
              strokeWidth="3"
              strokeLinecap="round"
              transform="rotate(-90 32 32)"
              initial={{ pathLength: prefersReducedMotion ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.path
              d="M20.5 33.2 L28.2 40.8 L44 24.2"
              stroke="#fffaf2"
              strokeWidth="4.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: prefersReducedMotion ? 1 : 0, opacity: prefersReducedMotion ? 1 : 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.42, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
            />
            <defs>
              <linearGradient id="ft3GoldRing" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#fde68a" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>
        </motion.div>
      </div>

      {/* Concise Celebration Headline & Amount Line */}
      <motion.div
        initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-1"
      >
        <h3 className="font-['Outfit',sans-serif] font-black text-lg sm:text-xl text-[#261508] tracking-tight leading-snug">
          Thanks for supporting FT.3hree!
        </h3>
        <p className="text-[11.5px] font-semibold text-[#755638] tabular-nums">
          {amount && amount > 0
            ? `₹${amount.toLocaleString('en-IN')} · Thank you!`
            : 'Thank you for your contribution!'}
        </p>
      </motion.div>

      {/* Optional Real-Time Homepage Supporter Submission Box */}
      <motion.div
        initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, delay: 0.34, ease: [0.16, 1, 0.3, 1] }}
        className="w-full rounded-2xl bg-white/55 border border-white/85 px-3.5 py-3 text-left shadow-2xs"
      >
        {submitState === 'saved' ? (
          <div className="flex items-center gap-2.5 py-1">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-emerald-700">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-[#261508]">Live on homepage!</p>
              <p className="text-[11px] font-medium text-[#6d5138] leading-snug">
                Your name &amp; photo are now visible in real-time.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitProfile} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold text-[#261508] tracking-tight">
                Show on Homepage (Optional)
              </span>
              {amount && amount > 0 && (
                <span className="text-[10.5px] font-extrabold text-[#6d5138] tabular-nums">
                  ₹{amount.toLocaleString('en-IN')} linked
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {/* Profile Picture Upload */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative h-11 w-11 shrink-0 rounded-full bg-white/85 border border-[#a68d6a]/45 hover:border-[#593e28] flex items-center justify-center overflow-hidden shadow-2xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#593e28]"
                aria-label="Upload profile photo"
                title="Upload profile photo"
              >
                {donorAvatar ? (
                  <img
                    src={donorAvatar}
                    alt="Selected profile"
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <svg
                    className="h-4 w-4 text-[#6d5138]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
                className="hidden"
              />

              {/* Donor Name Input */}
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  maxLength={DONOR_NAME_MAX_LENGTH}
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                  placeholder="Your name"
                  aria-label="Your name"
                  className="w-full px-3 py-2 rounded-xl bg-white/90 border border-[#a68d6a]/35 text-xs font-semibold text-[#261508] placeholder-[#9c8269] focus:outline-none focus:ring-1 focus:ring-[#593e28]"
                />
              </div>
            </div>

            {/* Public Display Consent Checkbox */}
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={publicConsent}
                onChange={(e) => setPublicConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded accent-[#2c1708] cursor-pointer shrink-0"
              />
              <span className="text-[10.5px] font-medium text-[#5e442c] leading-snug">
                Show my name &amp; photo on the homepage in real-time.
              </span>
            </label>

            {errorMessage && (
              <p className="text-[10.5px] font-semibold text-rose-700">{errorMessage}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className={`w-full py-2 px-3 rounded-xl font-['Outfit',sans-serif] font-bold text-xs transition-all border ${
                canSubmit
                  ? 'bg-[#2c1708] hover:bg-black text-[#fffaf2] border-black/80 shadow-xs active:scale-[0.98] cursor-pointer'
                  : 'bg-[#e9decb]/80 text-[#8a7057] border-[#a68d6a]/25 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? 'Saving...' : 'Submit for Homepage'}
            </button>
          </form>
        )}
      </motion.div>

      {/* Primary Close / Skip Action */}
      <motion.div
        initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, delay: 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="w-full pt-0.5"
      >
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-5 rounded-xl bg-gradient-to-r from-[#3a2210] via-[#2c1708] to-[#1e0f05] hover:from-[#2c1708] hover:to-black text-[#fffaf2] font-['Outfit',sans-serif] font-bold text-xs sm:text-sm shadow-md active:scale-[0.98] transition-all cursor-pointer border border-[#a68d6a]/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#593e28]"
        >
          {submitState === 'saved' ? 'Done' : 'Close'}
        </button>
      </motion.div>
    </div>
  );
};
