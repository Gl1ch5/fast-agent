export interface Call { id: string; name: string; args: any; bad?: string }
// text goes back to the model; show/tail are for the user
export interface Result { text: string; err?: boolean; show: string; tail?: string }
