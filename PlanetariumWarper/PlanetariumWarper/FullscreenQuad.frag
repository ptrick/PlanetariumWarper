#version 330 core

uniform sampler2D texSampler;
in vec2 UV;
out vec3 color;

const float pi = 3.14159265359;
const float a90 = pi / 2.0;
const float a2rad = pi / 180.0;

// 10 geometric parameters (all(?) variable) + 5 output variables
// Mirror & Projector
const float R = 0.30;   // equatorial radius of 1/4 sphere mirror (polar radius is R*b/a)
const float v = 0.95;   // projector horiz distance from mirror center in tilted-table plane
const float beam = 35.0 * a2rad;  // projector opening angle (horizontal)
const float ar = 16.0/9.0;  // projector aspect ratio
const float alpha = 7.0 * a2rad;  // tilt, positive if mirror is higher than projector
const float beta = 0.1 * a2rad;   // angle between tilted table and bottom row of pixels
const float ba = 0.99;  // b/a, the axial ratio for the oblate spheroid
// Dome:
const float M = 2.5; // meters.  Radial distance of mirror center to dome center
const float H = 1.0;    // meters. gap from bottom of dome to mirror center
const float S = 3.658;  // meters. dome radius 
// Output:
const float phaseangle = -a90;    // I /think/ this is correct
const float horiz_flip = 0;       // these will eventually be used.
const float vert_flip = 0;

// derived parameters
const float mu = atanh(ba); // the constant mu corresponding to input axial ratio
const float a = R / cosh(mu); // invert (a cosh mu = semimajor axis) to get 'a' parameter
const float gamma = beam / ar;   // projector vertical opening angle

// 3 functions to deal with oblate coordinate system
// returns cartesian coords given oblate coords
vec3 cartesian(in float a, in float mu, in float nu, in float phi)
{
    vec3 rv = vec3(0, 0, 0);
    rv.x = a*cosh(mu)*cos(nu)*cos(phi);
    rv.y = a*cosh(mu)*cos(nu)*sin(phi);
    rv.z = a*sinh(mu)*sin(nu);
    return rv;
}

// returns oblate coords given cartesian coords
void oblate(in float a, in float x, in float y, in float z, out float mu, out float nu, out float phi)
{
    phi = atan(y,x);
    float rho = sqrt(x*x + y*y);
    float d1 = sqrt( pow(rho + a,2) +z*z);
    float d2 = sqrt( pow(rho - a,2) +z*z);
    mu = acosh( (d1+d2)/(2.0*a));
    nu = acos( (d1-d2)/(2.0*a));
}

// returns a cartesian vector that is local to the oblate spheroid surface
vec3 onormal(in float mu, in float nu, in float phi)
{
    vec3 normal = vec3(0,0,0);
    float scale = 1.0/sqrt(pow(sinh(mu),2) + pow(sin(nu),2));
    normal.x = scale*sinh(mu)*cos(nu)*cos(phi);
    normal.y = scale*sinh(mu)*cos(nu)*sin(phi);
    normal.z = scale*cosh(mu)*sin(nu);
    return normal;
}

vec3 getWarpMap(in vec2 screenCoords)
{
    vec3 warp = vec3(0, 0, 1);

    float intensity = 1.0;

    float cpix = 0.5;
    // coming out of the projector, pixels to angles
    float a1 = beam * (screenCoords.x - 0.5);  // x direction angle
    float a2 = gamma *screenCoords.y; // y direction angle
    // ray in physical space
    //a1 = a1
    a2 += beta;
    // Does the ray intersect with oblate spheroid?
    // Max distance to consider is v.   Min is v-R.
    // 1. check the max to toss out clean misses.
    float x1 = v * sin(a1);
    float x2 = v * sin(a2);
    // outside/inside parameter oi
    // To sphere-centered origin: x = (v - dd) ; y = x1 ; z = x2
    float mu1,nu1,phi1;
    oblate(a,0.0,x1,x2, mu1, nu1, phi1);

    if (mu1 > mu)
    {
        intensity = 0;
    }

    // bisect to a tolerable precision
    float tol = 1.0e-8;
    float left = v;
    float right = v-R;
    float stat = 1000.0;
    while (stat > tol)
    {
        float mid = 0.5*(left + right);
        float x1 = mid * sin(a1);
        float x2 = mid * sin(a2);
        oblate(a,v-mid,x1,x2,mu1,nu1,phi1);
        // having gone to the trouble to use oblate coords, test is easy
        if (mu1 < mu)
        {
            stat = (left - mid) / R;
            left = mid;
        }
        else
        {
            stat = (mid - right) / R;
            right = mid;
        }
    }

    // still considering one "successful" ray
    vec3 location = cartesian(a,mu1,nu1,phi1);
    vec3 normal = onormal(mu1,nu1,phi1);

    vec3 svec = normalize(location * vec3(1, -1, -1));
    float constant = 2.0 * dot(normal, svec);
    vec3 rvec = constant * (normal - svec);

    float size = length(rvec);
    // track the outbound ray to the dome.
    // Apply a tilt of alpha about the origin of the mirror
    float rtmp = length(location.xy);
    float thet = atan(location.z,location.x);
    thet += alpha; // apply tilt (y coordinate is unchanged)
    location.x = rtmp*cos(thet);
    location.z = rtmp*sin(thet);
    float rtiny = length(rvec.xz);
    thet = atan(rvec.z,rvec.x);
    thet += alpha; // tilt reflected ray
    rvec.x = rtiny*cos(thet);
    rvec.z = rtiny*sin(thet);
    // go to dome-center for the origin of the coordinate system
    location.x -= M;
    location.z -= H;
    
    // Test a vertical travel of domebottomheight = H - z
    float rzz = (-location.z)/rvec.z;

    vec3 location1 = location + rzz * rvec;

    rtmp = length(location1);
    if (rvec.z < 0.0 || rtmp > S)
    {
        intensity = 0;
    }
        
    // proceed by bisection to find Alt/Az on dome
    tol = 1.0e-8;
    left = rzz;
    right = 3.0*S;
    stat = 1000.0;
    while (stat > tol)
    {
        float mid = 0.5*(left + right);
        location1 = location + mid * rvec;

        if (length(location1) < S)
        {
            stat = (mid - left) / S;
            left = mid;
        }
        else
        {
            stat = (right - mid) / S;
            right = mid;
        }
    }

    // results
    float polarAngle = acos(location1.z/S); // polar angle (range 0 to pi/2)
    float alt = a90 - polarAngle;       // dome coordinate "altitude"
    float azi = atan(location1.y,location1.x); // dome coordinate "azimuth"

    float uu = polarAngle*cos(azi+phaseangle);
    float vv = polarAngle*sin(azi+phaseangle);

    uu = uu*0.5/a90 + 0.5;
    vv = vv*0.5/a90 + 0.5;

    warp.x = uu;
    warp.y = vv;
    warp.z = intensity;

    return warp;
}

void main()
{
    vec3 warp = getWarpMap(UV);
    color = texture(texSampler, warp.rg).rgb * warp.b;
}