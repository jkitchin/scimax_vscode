/**
 * Activation status tracking.
 *
 * activate() is a long linear sequence of registrations. An unguarded exception
 * anywhere in it drops every command registered after that point, which users see
 * as "command 'scimax.foo' not found" from an extension that looks installed and
 * enabled. Steps are run through activationStep() so a failure is recorded here
 * instead of aborting the rest of activation.
 */

const failures: string[] = [];

/** Record a failed activation step by name. */
export function recordActivationFailure(name: string): void {
    failures.push(name);
}

/** Names of the activation steps that threw, in the order they ran. */
export function getActivationFailures(): string[] {
    return [...failures];
}
