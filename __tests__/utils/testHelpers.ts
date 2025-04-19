import request from 'supertest';

/**
 * Calls an endpoint multiple times and validates the response using the provided assertion callback.
 *
 * @param times - The number of times to call the endpoint.
 * @param url - The URL of the endpoint to call.
 * @param assertionCallback - A callback function to validate the response.
 * @param client - The Supertest client instance to use for making requests.
 */
export const callEndpoint = async (
    times: number,
    url: string,
    assertionCallback: (res: request.Response) => void,
    client: request.SuperTest<request.Test>
): Promise<void> => {
    if (times <= 0) {
        throw new Error('The "times" parameter must be greater than 0.');
    }
    if (!url) {
        throw new Error('The "url" parameter must be a non-empty string.');
    }
    if (typeof assertionCallback !== 'function') {
        throw new Error('The "assertionCallback" parameter must be a function.');
    }

    for (let i = 0; i < times; i++) {
        const res = await client.get(url);
        assertionCallback(res);
    }
};
