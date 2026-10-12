import { lazy, Suspense } from 'react'
import DesktopLoading from '../DesktopLoading'

// Member Map pulls in Leaflet; only the owner ever opens it, so it loads as its
// own chunk instead of riding in everyone's main bundle.
const MemberMap = lazy(() => import('./MemberMap'))

export default function MemberMapLazy(props) {
  return (
    <Suspense fallback={<DesktopLoading />}>
      <MemberMap {...props} />
    </Suspense>
  )
}
