export type InboxErrorCode =
  | 'not_configured'
  | 'network'
  | 'authentication'
  | 'rate_limit'
  | 'invalid_response'
  | 'dispatch'
  | 'storage'
  | 'provider_error';

type ErrorDefinition = {
  message: string;
  shortLabel: string;
  autoRetry: boolean;
};

const ERROR_DEFINITIONS: Record<InboxErrorCode, ErrorDefinition> = {
  not_configured: {
    message: 'Configura la IA en Ajustes para clasificar esta captura.',
    shortLabel: 'Falta configurar la IA',
    autoRetry: false,
  },
  network: {
    message: 'Sin conexión. La captura se reintentará automáticamente.',
    shortLabel: 'Sin conexión',
    autoRetry: true,
  },
  authentication: {
    message: 'La configuración de IA no es válida. Revísala en Ajustes.',
    shortLabel: 'Configuración de IA no válida',
    autoRetry: false,
  },
  rate_limit: {
    message: 'La IA está saturada. La captura se reintentará automáticamente.',
    shortLabel: 'IA saturada',
    autoRetry: true,
  },
  invalid_response: {
    message: 'La IA devolvió una respuesta no válida. Reinténtalo manualmente.',
    shortLabel: 'Respuesta de IA no válida',
    autoRetry: false,
  },
  dispatch: {
    message: 'No se pudo guardar la clasificación. Reinténtalo manualmente.',
    shortLabel: 'Clasificación sin guardar',
    autoRetry: false,
  },
  storage: {
    message: 'No se pudo acceder a la captura. Tus datos siguen guardados.',
    shortLabel: 'Problema de almacenamiento',
    autoRetry: false,
  },
  provider_error: {
    message: 'El proveedor de IA rechazó la petición. Revisa la configuración.',
    shortLabel: 'Error del proveedor de IA',
    autoRetry: false,
  },
};

export class InboxPipelineError extends Error {
  readonly code: InboxErrorCode;
  readonly technicalCode: string;

  constructor(code: InboxErrorCode, technicalCode: string) {
    super(ERROR_DEFINITIONS[code].message);
    this.name = 'InboxPipelineError';
    this.code = code;
    this.technicalCode = technicalCode;
  }
}

export function getInboxErrorMessage(code: InboxErrorCode): string {
  return ERROR_DEFINITIONS[code].message;
}

export function getInboxErrorShortLabel(code: InboxErrorCode): string {
  return ERROR_DEFINITIONS[code].shortLabel;
}

export function isInboxErrorRetryable(code: InboxErrorCode): boolean {
  return ERROR_DEFINITIONS[code].autoRetry;
}
