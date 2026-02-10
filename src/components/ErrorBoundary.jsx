import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary capturou erro:', error, errorInfo)
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f0f0f',
            color: 'rgba(255,255,255,0.9)',
            padding: '24px',
            textAlign: 'center'
          }}
        >
          <h1 style={{ fontSize: '24px', marginBottom: '12px' }}>Algo deu errado</h1>
          <p style={{ marginBottom: '24px', opacity: 0.8 }}>
            Ocorreu um erro inesperado. Tente recarregar a página.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '12px 24px',
              backgroundColor: '#d4af37',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 600
            }}
          >
            Recarregar página
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
