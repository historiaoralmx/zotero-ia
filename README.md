# Zotero IA

Complemento de Humanistyc para investigar y organizar referencias en Zotero.

## Instalación

Descarga el archivo `.xpi` desde [el último release estable](https://github.com/historiaoralmx/zotero-ia/releases/latest). En Zotero, abre **Herramientas → Complementos**, pulsa el engranaje y selecciona **Instalar complemento desde archivo**.

## Actualizaciones automáticas

Instala la **1.9.28 o posterior manualmente una vez**. Desde esa versión, Zotero utiliza su actualizador nativo para comprobar los releases estables de este repositorio. Deja activadas las actualizaciones automáticas de Zotero IA en el administrador de complementos. También puedes usar **Buscar actualizaciones**; puede ser necesario reiniciar Zotero para completar la instalación.

Las versiones anteriores necesitan esa instalación inicial porque su canal estaba desactivado. No se ofrecen borradores ni versiones preliminares. La comprobación de actualizaciones no requiere API ni consume tokens.

## Publicar una nueva versión

1. Incorpora los cambios y actualiza `manifest.json`, el manual y el registro de cambios con una versión nueva.
2. Ejecuta el empaquetador con el tag correspondiente: por ejemplo, `python3 build_release.py --tag v1.9.29 --output dist`.
3. Crea un release con ese mismo tag y adjunta los cuatro archivos generados en `dist`: el XPI, `updates.json`, el manual y `checksums.txt`. Publica el release como estable después de adjuntarlos.

Los usuarios recibirán la actualización mediante Zotero. El empaquetado se ejecuta localmente; no se ha habilitado ningún proceso de GitHub Actions con permisos para modificar el repositorio.

El actualizador nativo consulta `https://github.com/historiaoralmx/zotero-ia/releases/latest/download/updates.json`. Ese archivo enlaza el XPI de la versión concreta y su hash SHA-256. La versión del manifiesto y del tag deben coincidir; publicar un tag nuevo sin actualizar el código no genera un instalador válido. Evita sustituir un release ya distribuido: publica una versión superior para cualquier corrección.

Comprobación y empaquetado local, sin dependencias externas:

```sh
python3 -m unittest test_release -v
python3 build_release.py --tag v1.9.28 --output dist
```

Consulta [LEEME.txt](LEEME.txt) para conocer la configuración y el uso, y [CHANGELOG.md](CHANGELOG.md) para revisar los cambios por versión.
