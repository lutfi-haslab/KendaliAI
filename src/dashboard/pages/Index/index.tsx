/**
 * KendaliAI Dashboard - Index Page
 * 
 * TODO: Full dashboard implementation planned for future release.
 * Current focus: CLI-based operations (cli-minimal.ts)
 */

export function IndexPage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#0f0f0f',
      color: '#ffffff',
    }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
        🚧 KendaliAI Dashboard
      </h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>
        Under Construction
      </p>
      
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '2rem',
        borderRadius: '12px',
        maxWidth: '600px',
        width: '100%',
      }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#4ade80' }}>
          Use the CLI instead:
        </h2>
        
        <code style={{
          display: 'block',
          backgroundColor: '#0a0a0a',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '0.5rem',
          fontSize: '0.875rem',
        }}>
          $ kendaliai onboard --provider deepseek --api-key sk-xxx
        </code>
        
        <code style={{
          display: 'block',
          backgroundColor: '#0a0a0a',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '0.5rem',
          fontSize: '0.875rem',
        }}>
          $ kendaliai channel add-telegram --bot-token "TOKEN"
        </code>
        
        <code style={{
          display: 'block',
          backgroundColor: '#0a0a0a',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '0.5rem',
          fontSize: '0.875rem',
        }}>
          $ kendaliai gateway
        </code>
        
        <code style={{
          display: 'block',
          backgroundColor: '#0a0a0a',
          padding: '0.75rem',
          borderRadius: '6px',
          fontSize: '0.875rem',
        }}>
          $ kendaliai status
        </code>
      </div>
      
      <p style={{ marginTop: '2rem', color: '#666', fontSize: '0.875rem' }}>
        📖 Docs:{' '}
        <a 
          href="https://github.com/kendaliai/kendaliai" 
          style={{ color: '#4ade80' }}
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/kendaliai/kendaliai
        </a>
      </p>
    </div>
  );
}

export default IndexPage;
