use std::error::Error;

use tabularis_web_server::config::AppConfig;
use tabularis_web_server::metadata::MetadataStore;
use tabularis_web_server::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tabularis_web_server=info".into()),
        )
        .init();

    let config = AppConfig::from_env()?;
    config.secrets.key_manager()?;
    let metadata = MetadataStore::connect(
        &config.metadata_database_url,
        config.metadata_max_connections,
    )
    .await?;
    let state = AppState::from_config(metadata, &config).await?;

    let listener = tokio::net::TcpListener::bind(config.bind_address).await?;

    tracing::info!(
        bind_address = %config.bind_address,
        public_origin = %config.public_origin,
        "Tabularis web server listening"
    );

    axum::serve(listener, tabularis_web_server::app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "Failed to install shutdown signal handler");
    }
}
