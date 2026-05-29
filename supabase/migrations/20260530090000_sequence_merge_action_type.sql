-- Add the structural "merge" action type (passthrough join node where branches
-- converge). Additive-only ; safe on the single cloud prod DB.
ALTER TYPE "sequence_step_action_type" ADD VALUE IF NOT EXISTS 'merge';
