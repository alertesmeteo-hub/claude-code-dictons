<?php
/**
 * Plugin Name: Températures Extrêmes France
 * Description: Affiche les températures extrêmes du jour en France (stations sous 500 m) via le shortcode [temperatures_extremes_france]. Consomme l'API du SaaS dicton-du-jour.alertes-meteo.com, ne duplique aucune logique météo.
 * Version: 1.1.1
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Alertes Météo
 * Text Domain: temperatures-extremes-france
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'TEF_VERSION', '1.1.1' );
// La clé de cache contient la version : une mise à jour du plugin invalide l'ancien cache.
define( 'TEF_CACHE_KEY', 'tef_extremes_france_' . TEF_VERSION );
define( 'TEF_CACHE_DUREE', 15 * MINUTE_IN_SECONDS );
define( 'TEF_TIMEOUT_SECONDES', 5 );

/**
 * URL de l'API, configurable via wp-config.php :
 * define( 'TEF_API_URL', 'https://dicton-du-jour.alertes-meteo.com/api/v1/extremes/france' );
 */
function tef_get_api_url() {
	if ( defined( 'TEF_API_URL' ) ) {
		return TEF_API_URL;
	}
	return 'https://dicton-du-jour.alertes-meteo.com/api/v1/extremes/france';
}

function tef_recuperer_donnees() {
	$cache = get_transient( TEF_CACHE_KEY );
	if ( false !== $cache ) {
		return $cache;
	}

	$reponse = wp_remote_get(
		tef_get_api_url(),
		array(
			'timeout' => TEF_TIMEOUT_SECONDES,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $reponse ) || 200 !== wp_remote_retrieve_response_code( $reponse ) ) {
		return false;
	}

	$corps    = wp_remote_retrieve_body( $reponse );
	$donnees  = json_decode( $corps, true );

	if ( ! is_array( $donnees ) || ! isset( $donnees['donnees'] ) ) {
		return false;
	}

	set_transient( TEF_CACHE_KEY, $donnees, TEF_CACHE_DUREE );

	return $donnees;
}

function tef_shortcode_temperatures_extremes( $atts ) {
	$atts = shortcode_atts(
		array(
			'limite'   => 3,
			'stations' => 'toutes', // « principales » : uniquement le réseau principal Météo-France
		),
		$atts,
		'temperatures_extremes_france'
	);

	$donnees = tef_recuperer_donnees();

	ob_start();
	?>
	<div class="tef-widget">
		<h3 class="tef-titre">Températures extrêmes du jour — stations sous 500 m</h3>
		<?php if ( false === $donnees || empty( $donnees['donnees'] ) ) : ?>
			<p class="tef-fallback">Données momentanément indisponibles. Réessayez plus tard.</p>
		<?php else : ?>
			<ul class="tef-liste">
				<?php
				// « limite » = nombre de stations affichées pour les maxima ET pour les minima.
				$limite = max( 1, (int) $atts['limite'] );
				$source = $donnees['donnees'];
				if ( 'principales' === strtolower( trim( $atts['stations'] ) ) ) {
					$source = array_values( array_filter( $source, function ( $l ) { return ! empty( $l['principale'] ); } ) );
				}
				$maxis  = array_slice( array_values( array_filter( $source, function ( $l ) { return 'maxi' === $l['type']; } ) ), 0, $limite );
				$minis  = array_slice( array_values( array_filter( $source, function ( $l ) { return 'mini' === $l['type']; } ) ), 0, $limite );
				$lignes = array_merge( $maxis, $minis );
				foreach ( $lignes as $ligne ) :
					$type_libelle = 'maxi' === $ligne['type'] ? 'MAXI' : 'MINI';
					?>
					<li class="tef-ligne tef-<?php echo esc_attr( $ligne['type'] ); ?>">
						<span class="tef-type"><?php echo esc_html( $type_libelle ); ?></span>
						<span class="tef-commune"><?php echo esc_html( $ligne['commune'] ); ?></span>
						<span class="tef-departement">(<?php echo esc_html( $ligne['departement'] ); ?>)</span>
						<span class="tef-valeur"><?php echo esc_html( number_format_i18n( $ligne['valeurC'], 1 ) ); ?> °C</span>
					</li>
				<?php endforeach; ?>
			</ul>
			<?php if ( ! empty( $donnees['derniereMiseAJour'] ) ) : ?>
				<p class="tef-maj">
					Source : METEO-FRANCE dernière mise à jour :
					<?php echo esc_html( wp_date( 'd/m/Y H:i', strtotime( $donnees['derniereMiseAJour'] ) ) ); ?>
				</p>
			<?php endif; ?>
		<?php endif; ?>
	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'temperatures_extremes_france', 'tef_shortcode_temperatures_extremes' );

function tef_enqueue_styles() {
	wp_register_style( 'tef-style', false, array(), TEF_VERSION );
	wp_enqueue_style( 'tef-style' );
	wp_add_inline_style( 'tef-style', tef_css_par_defaut() );
}
add_action( 'wp_enqueue_scripts', 'tef_enqueue_styles' );

function tef_css_par_defaut() {
	return '
	.tef-widget { max-width: 480px; font-family: inherit; }
	.tef-titre { font-size: 1.1rem; margin-bottom: 8px; }
	.tef-liste { list-style: none; margin: 0; padding: 0; }
	.tef-ligne { display: flex; gap: 8px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
	.tef-type { font-weight: 700; font-size: 0.8rem; padding: 2px 6px; border-radius: 4px; }
	.tef-maxi .tef-type { background: #fee2e2; color: #b91c1c; }
	.tef-mini .tef-type { background: #dbeafe; color: #1d4ed8; }
	.tef-commune { font-weight: 600; }
	.tef-departement { color: #64748b; font-size: 0.9rem; }
	.tef-valeur { margin-left: auto; font-weight: 700; }
	.tef-maj { font-size: 0.8rem; color: #64748b; margin-top: 8px; }
	.tef-fallback { color: #64748b; font-style: italic; }
	@media (max-width: 480px) { .tef-valeur { margin-left: 0; } }
	';
}
