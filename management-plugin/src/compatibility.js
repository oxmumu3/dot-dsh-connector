/** Exact public SDK versions validated by the release gate. */
export const VERIFIED_SDK_VERSIONS=Object.freeze(["0.2.1-rc.2","0.2.1-rc.3","0.2.1-rc.4","0.2.1-rc.5","0.2.2-rc.1"]);
export const sdkCordisVersion=sdk=>sdk==='0.2.2-rc.1'?'4.1.0':VERIFIED_SDK_VERSIONS.includes(sdk)?'4.0.5':undefined;
