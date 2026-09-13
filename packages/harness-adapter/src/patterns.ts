/** Conservative identifier accepted in every generated path. */
export const HARNESS_ASSET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Exact SemVer 2 versions accepted in package activation plans. */
export const PACKAGE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
