import packageJson from '@package';

export const AppConfig = {
    production: true,
    environment: 'PROD',
    version: packageJson.version,
    // Empty string => same-origin: PwaService calls /parse, /xtream, /stalker
    // on the iptvpwa.vercel.app deployment itself, where Vercel rewrites
    // route them to the api/*.ts serverless Functions in this repo.
    BACKEND_URL: '',
};
