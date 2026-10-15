import { Component } from 'react';
import { AlertCircle, Home, RotateCw } from 'lucide-react';
import { reloadOnce } from '../lib/lazyPage.js';

/** Si una pantalla falla, sólo ella muestra el aviso: el resto de la app (barra, menú) sigue funcionando. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) {
    // Archivos de una versión anterior (se publicó otra mientras estaba abierta): se recarga una vez.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(error?.message))) reloadOnce();
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="screen-error" role="alert">
        <AlertCircle size={28} />
        <b>Esta pantalla no cargó.</b>
        <p>Puede ser la conexión. Inténtelo de nuevo.</p>
        <div className="row-wrap" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}><RotateCw size={16} />Reintentar</button>
          <a className="btn" href="/"><Home size={16} />Ir al inicio</a>
        </div>
      </div>
    );
  }
}
