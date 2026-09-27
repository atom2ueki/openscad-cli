// A subtraction that leaves coincident faces: the classic non-manifold source.
difference() {
    cube(20, center = true);
    sphere(r = 15, center = true);
}
