export interface Call { id: string; name: string; args: any; bad?: string; extra?: any }   // extra: provider data echoed back (Gemini thought signatures)
// text goes back to the model; show/tail are for the user
export interface Result { text: string; err?: boolean; show: string; tail?: string; preview?: string[] }   // preview: colored lines under the card
