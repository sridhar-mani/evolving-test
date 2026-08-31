import { Schema } from "effect"
import { FlexibleNumber } from "../schema"

export const Classification = Schema.Struct({
  isTask: Schema.Boolean,
  taskType: Schema.String,
  taskSubType: Schema.optional(Schema.String),
  taskSubTypes: Schema.optional(Schema.Array(Schema.String)),
  summary: Schema.optional(Schema.String),
}).annotate({ identifier: "JudgeAgent.Classification" })

export type Classification = typeof Classification.Type

export const Evaluation = Schema.Struct({
  isSatisfied: Schema.Boolean,
  score: FlexibleNumber,
  codeQualityScore: Schema.optional(FlexibleNumber),
  originalityScore: Schema.optional(FlexibleNumber),
  completenessScore: Schema.optional(FlexibleNumber),
  efficiencyScore: Schema.optional(FlexibleNumber),
  robustnessScore: Schema.optional(FlexibleNumber),
  reasoning: Schema.String,
  critique: Schema.optional(Schema.String),
  flawsIdentified: Schema.optional(Schema.Array(Schema.String)),
  originalityHighlights: Schema.optional(Schema.Array(Schema.String)),
  reflections: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "JudgeAgent.Evaluation" })

export type Evaluation = typeof Evaluation.Type

export const SubtaskItem = Schema.Struct({
  content: Schema.String,
  status: Schema.String,
}).annotate({ identifier: "JudgeAgent.SubtaskItem" })

export type SubtaskItem = typeof SubtaskItem.Type

export const RegisterTaskInput = Schema.Struct({
  prompt: Schema.String,
  taskType: Schema.optional(Schema.String),
  taskSubType: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  taskSubTypes: Schema.optional(Schema.Array(Schema.String)),
  taskModel: Schema.optional(Schema.String),
  embedding: Schema.optional(Schema.Unknown),
  sessionID: Schema.optional(Schema.String),
}).annotate({ identifier: "JudgeAgent.RegisterTaskInput" })

export type RegisterTaskInput = typeof RegisterTaskInput.Type

export const EvaluateInput = Schema.Struct({
  taskID: Schema.String,
  sessionID: Schema.optional(Schema.String),
  originalPrompt: Schema.String,
  subtasks: Schema.optional(Schema.Array(SubtaskItem)),
  toolTraceSummary: Schema.optional(Schema.String),
  userResponse: Schema.optional(Schema.String),
}).annotate({ identifier: "JudgeAgent.EvaluateInput" })

export type EvaluateInput = typeof EvaluateInput.Type
