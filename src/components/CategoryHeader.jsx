import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function CategoryHeader({
  category,
  subcategory,
  briefId,
  variant = 'light',
  className = '',
}) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const handleAdminClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!briefId) return
    navigate('/admin', { state: { editBriefId: String(briefId) } })
  }

  const textColor = variant === 'dark' ? 'text-brand-500' : 'text-brand-600'
  const idColor   = variant === 'dark' ? 'text-brand-400 hover:text-brand-300' : 'text-brand-600 hover:text-brand-700'

  return (
    <p className={`text-xs font-semibold ${textColor} ${className}`}>
      {category}{subcategory ? ` · ${subcategory}` : ''}
      {user?.isAdmin && briefId && (
        <>
          {' · '}
          <button
            type="button"
            onClick={handleAdminClick}
            className={`font-mono text-[10px] ${idColor} hover:underline align-middle`}
            title="Open in admin editor"
          >
            {String(briefId)}
          </button>
        </>
      )}
    </p>
  )
}
