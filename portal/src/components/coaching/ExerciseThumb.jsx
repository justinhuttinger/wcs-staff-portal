import { useState } from 'react'

// Muscle-tinted placeholders so an image-less exercise still reads at a glance.
const TINTS = {
  chest: 'bg-rose-100 text-rose-700', shoulders: 'bg-orange-100 text-orange-700',
  triceps: 'bg-amber-100 text-amber-700', biceps: 'bg-yellow-100 text-yellow-800',
  lats: 'bg-sky-100 text-sky-700', 'middle back': 'bg-blue-100 text-blue-700',
  traps: 'bg-indigo-100 text-indigo-700', 'lower back': 'bg-violet-100 text-violet-700',
  quadriceps: 'bg-emerald-100 text-emerald-700', hamstrings: 'bg-teal-100 text-teal-700',
  glutes: 'bg-lime-100 text-lime-800', calves: 'bg-green-100 text-green-700',
  abdominals: 'bg-fuchsia-100 text-fuchsia-700',
}

const SIZES = {
  sm: 'w-10 h-10 text-sm rounded-md',
  md: 'w-full aspect-[4/3] text-2xl rounded-lg',
  lg: 'w-full aspect-[4/3] text-4xl rounded-xl',
}

export default function ExerciseThumb({ exercise, size = 'sm' }) {
  const [broken, setBroken] = useState(false)
  const box = SIZES[size] || SIZES.sm
  const muscle = exercise?.primary_muscle || ''
  if (exercise?.thumbnail_url && !broken) {
    return (
      <img
        src={exercise.thumbnail_url} alt="" loading="lazy" onError={() => setBroken(true)}
        className={`${box} object-cover bg-bg border border-border shrink-0`}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={`${box} ${TINTS[muscle] || 'bg-bg text-text-muted'} flex items-center justify-center font-bold uppercase shrink-0 border border-border`}
    >
      {(muscle || exercise?.name || '?').slice(0, 1)}
    </div>
  )
}
