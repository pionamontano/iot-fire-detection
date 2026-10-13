// Host tests for the pure identity validators in src/identity.h
#include "../src/identity.h"
#include <cstdio>
#include <string>

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; std::printf("FAIL line %d: %s\n", __LINE__, #c); } } while (0)

int main() {
    using namespace agap;
    // device id
    CHECK(validDeviceId("AGS-001"));
    CHECK(validDeviceId("bantay-apoy-node-001"));
    CHECK(validDeviceId("a.b_c-1"));
    CHECK(!validDeviceId(nullptr));
    CHECK(!validDeviceId(""));
    CHECK(!validDeviceId("has space"));
    CHECK(!validDeviceId("quo\"te"));
    CHECK(!validDeviceId("a&b=c"));          // would break the config URL query
    CHECK(!validDeviceId("back\\slash"));  // would break the JSON payload
    CHECK(!validDeviceId("new\nline"));
    CHECK(!validDeviceId("\xc3\xa9"));         // non-ASCII
    CHECK(validDeviceId(std::string(kDeviceIdMax, 'a').c_str()));
    CHECK(!validDeviceId(std::string(kDeviceIdMax + 1, 'a').c_str()));
    // api key
    CHECK(validApiKey("sk_0123456789abcdef0123456789abcdef0123456789abcdef"));  // real shape: sk_ + 48 hex
    CHECK(validApiKey("abcdefgh"));
    CHECK(!validApiKey("short"));
    CHECK(!validApiKey(nullptr));
    CHECK(!validApiKey(""));
    CHECK(!validApiKey("has space in key"));
    CHECK(!validApiKey("key\"withquote"));
    CHECK(!validApiKey("dots.not.allowed"));
    CHECK(validApiKey(std::string(kApiKeyMax, 'k').c_str()));
    CHECK(!validApiKey(std::string(kApiKeyMax + 1, 'k').c_str()));
    // fits the 51-char backend key
    CHECK(kApiKeyMax >= 51);
    std::printf("%d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
